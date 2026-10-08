"use client";

import type { ReactNode } from "react";
import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, DPill, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, PacketAnatomy, StateTransition, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import { ExplainIt, KnowledgeCheck, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { executeCli } from "@/lib/cli/parser";
import { ciscoMac } from "@/lib/cli/format";
import type { CliVendor } from "@/lib/cli/types";
import { BROADCAST_MAC, ETH_MAC, FDB_AGING_SEC } from "@/lib/sim-engine/scenarios/ethernetSwitching";
import { createEthLabState, type EthLabAction, type EthLabState } from "@/lib/sim-engine/scenarios/ethernetLab";
import { ethernetSw1Cli } from "./cliAdapter";
import { runInstant } from "@/lib/sim-engine/scenarios/ethernetLab";
import { BroadcastVsUnknownDiagram, FirstFrameDiagram, MoveDiagram, ReplyDiagram, StaleDiagram, TopologyDiagram } from "./LessonGuideContent";

/**
 * ETHERNET & SWITCHING DEEP DIVE — the complete lesson, taught on ONE network: the exact SW1 / DESK-SW /
 * HOST-A·B·C topology of the guided lesson and the Ethernet Lab. Every MAC and port comes from
 * ethernetSwitching.ts, and every CLI sample below is produced by running the Ethernet Lab model to that point and
 * executing the real SW1 CLI adapter — the guide, the lesson and the lab cannot drift apart.
 *
 * Progression: Foundation → The frame → The switch decides → State over time → Operations → Advanced → Master it.
 */

const G = { foundation: "Foundation", frame: "The frame", decide: "The switch decides", state: "State over time", ops: "Operations", advanced: "Advanced", master: "Master it" };

export const ETH_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ethd-why", label: "Why switching exists", group: G.foundation },
  { id: "ethd-model", label: "The learning-bridge model", group: G.foundation },
  { id: "ethd-frame", label: "Ethernet II frame anatomy", group: G.frame },
  { id: "ethd-mac", label: "MAC address structure", group: G.frame },
  { id: "ethd-learn", label: "Source learning", group: G.decide },
  { id: "ethd-lookup", label: "Destination lookup", group: G.decide },
  { id: "ethd-decision", label: "Flood / forward / filter", group: G.decide },
  { id: "ethd-bum", label: "Unknown unicast vs broadcast", group: G.decide },
  { id: "ethd-nic", label: "Host NIC filtering", group: G.decide },
  { id: "ethd-fdb", label: "The FDB (MAC table)", group: G.state },
  { id: "ethd-transitions", label: "Before and after, frame by frame", group: G.state },
  { id: "ethd-aging", label: "Aging", group: G.state },
  { id: "ethd-move", label: "Host movement", group: G.state },
  { id: "ethd-flush", label: "Link-down flush", group: G.state },
  { id: "ethd-linkup", label: "Why link-up teaches nothing", group: G.state },
  { id: "ethd-stale", label: "Stale entries", group: G.state },
  { id: "ethd-domain", label: "Broadcast domains", group: G.state },
  { id: "ethd-managed", label: "Managed vs unmanaged", group: G.state },
  { id: "ethd-cli", label: "Cisco and Junos verification", group: G.ops },
  { id: "ethd-ifstate", label: "Interface state", group: G.ops },
  { id: "ethd-workflow", label: "Troubleshooting workflow", group: G.ops },
  { id: "ethd-failures", label: "Failure signatures", group: G.ops },
  { id: "ethd-incident", label: "The DESK-SW incident", group: G.ops },
  { id: "ethd-myths", label: "Common misconceptions", group: G.ops },
  { id: "ethd-router", label: "Switch vs router", group: G.advanced },
  { id: "ethd-quiz", label: "Knowledge check", group: G.master },
  { id: "ethd-explain", label: "Can you explain it?", group: G.master },
  { id: "ethd-practice", label: "Practice in the Ethernet Lab", group: G.master },
];

// ------------------------------------------------------------------ network facts (one source)

const A = ETH_MAC["HOST-A"];
const B = ETH_MAC["HOST-B"];
const C = ETH_MAC["HOST-C"];

// The Ethernet Lab's own model produces every state below (and so every CLI sample).
const play = (s: EthLabState, actions: EthLabAction[]) => actions.reduce(runInstant, s);
const send = (src: "HOST-A" | "HOST-B" | "HOST-C", dst: "HOST-A" | "HOST-B" | "HOST-C" | "broadcast"): EthLabAction => ({ type: "send", src, dst });
const LAB_T0 = createEthLabState();
const LAB_T1 = play(LAB_T0, [send("HOST-A", "HOST-B")]);
const LAB_T2 = play(LAB_T1, [send("HOST-B", "HOST-A")]);
const LAB_T4 = play(LAB_T2, [send("HOST-A", "HOST-B"), send("HOST-C", "broadcast")]);
const LAB_AGED = play(LAB_T4, [{ type: "time", seconds: 200 }, send("HOST-A", "HOST-B"), { type: "time", seconds: 150 }]);
const LAB_MOVED = play(LAB_AGED, [send("HOST-B", "HOST-A"), { type: "move-b", to: "desk" }]);
const LAB_DESK = play(LAB_MOVED, [send("HOST-B", "HOST-A")]);
const LAB_STALE = play(LAB_DESK, [{ type: "move-b", to: "sw1" }, send("HOST-A", "HOST-B")]);
const LAB_FIXED = play(LAB_STALE, [{ type: "clear", mac: B }, send("HOST-A", "HOST-B"), send("HOST-B", "HOST-A"), send("HOST-A", "HOST-B")]);

function cli(state: EthLabState, vendor: CliVendor, command: string) {
  const set = ethernetSw1Cli(vendor, state.net);
  const r = executeCli(set, command);
  return { prompt: set.prompt, command, output: r.kind === "ok" ? r.output : "" };
}

const Strong = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

function CliPanel({ prompt, command, output, caption }: { prompt: string; command: string; output: string; caption?: string }) {
  return (
    <figure className="min-w-0">
      {caption && <figcaption className="mb-1 text-[10px] font-bold uppercase tracking-wide text-pv-text-faint">{caption}</figcaption>}
      <div className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#05080d]">
        <pre className="overflow-x-auto px-3 py-2 pv-mono text-[10.5px] leading-relaxed text-pv-text-muted">
          <span className="text-pv-success">{prompt}</span>
          <span className="text-pv-text">{command}</span>
          {"\n"}
          {output}
        </pre>
      </div>
    </figure>
  );
}

const fdbRows = (s: EthLabState) => (s.net.fdb.SW1.length ? s.net.fdb.SW1.map((e) => [<Mono key="m">{e.mac}</Mono>, e.port, "dynamic", `${s.net.clock - e.lastSeen} s`]) : [["(empty)", "", "", ""]]);

/** Local practice bridge: opens the Ethernet Lab when the guide is shown inside the lesson (renders nothing otherwise). */
function LabBridge({ label, children }: { label: string; children: ReactNode }) {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label={label} onPractice={openLab}>
      {children}
    </PracticeBridge>
  );
}

// ------------------------------------------------------------------ diagrams (deep-dive specific)

function FrameDiagram() {
  return (
    <DiagramSvg h={170} label="Ethernet II frame: Destination MAC 6 bytes, Source MAC 6 bytes, EtherType 2 bytes, Payload 46 to 1500 bytes, FCS 4 bytes; preamble and SFD precede it on the wire">
      <DFieldRow
        x={20}
        y={40}
        fields={[
          { label: "Preamble+SFD", sub: "8 B (PHY)", w: 90, color: D.faint },
          { label: "Destination", sub: "6 B", w: 100, color: D.cyan, strong: true },
          { label: "Source", sub: "6 B", w: 100, color: D.warning, strong: true },
          { label: "EtherType", sub: "2 B", w: 80, color: D.violet },
          { label: "Payload", sub: "46–1500 B", w: 150, color: D.ip },
          { label: "FCS", sub: "4 B", w: 70, color: D.eth },
        ]}
      />
      <DArrow x1={160} y1={120} x2={160} y2={92} color={D.cyan} />
      <text x={160} y={136} textAnchor="middle" fill={D.cyan} fontSize={10}>
        forwarding lookup
      </text>
      <DArrow x1={260} y1={120} x2={260} y2={92} color={D.warning} />
      <text x={260} y={136} textAnchor="middle" fill={D.warning} fontSize={10}>
        source learning
      </text>
      <text x={20} y={24} fill={D.muted} fontSize={10}>
        header = 14 bytes · minimum frame 64 bytes (Dst…FCS) · a switch leaves every field unchanged
      </text>
      <text x={575} y={136} textAnchor="middle" fill={D.muted} fontSize={10}>
        CRC-32 check
      </text>
    </DiagramSvg>
  );
}

function MacDiagram() {
  return (
    <DiagramSvg h={190} label={`MAC address ${A}: first three octets are the OUI, last three are assigned by the vendor; in the first octet bit 0 is I/G (group) and bit 1 is U/L (locally administered)`}>
      <DFieldRow x={80} y={30} fields={A.split(":").map((o, i) => ({ label: o, sub: `octet ${i + 1}`, w: 80, color: i < 3 ? D.violet : D.cyan, strong: i === 0 }))} />
      <text x={200} y={110} textAnchor="middle" fill={D.violet} fontSize={10.5} fontWeight={700}>
        OUI (organization)
      </text>
      <text x={440} y={110} textAnchor="middle" fill={D.cyan} fontSize={10.5} fontWeight={700}>
        vendor-assigned
      </text>
      <text x={80} y={140} fill={D.text} fontSize={10.5} fontWeight={700}>
        First octet, least-significant bits:
      </text>
      <text x={80} y={158} fill={D.muted} fontSize={10}>
        bit 0 = I/G: 0 individual (unicast), 1 group (multicast / broadcast)
      </text>
      <text x={80} y={174} fill={D.muted} fontSize={10}>
        bit 1 = U/L: 0 universally administered, 1 locally administered · {BROADCAST_MAC} has every bit set
      </text>
    </DiagramSvg>
  );
}

function DecisionDiagram() {
  const box = (x: number, y: number, t: string, c: string, w = 150) => <DNode x={x} y={y} label={t} accent={c} w={w} h={34} />;
  return (
    <DiagramSvg h={350} label="Bridge decision: receive and check FCS, learn source, then if destination is group address flood; else look up; hit on another port forward; hit on ingress port filter; miss flood">
      {box(100, 30, "Receive · FCS OK?", D.eth)}
      {box(100, 90, "Learn SOURCE → port", D.warning)}
      {box(100, 150, "Destination group?", D.violet)}
      {box(330, 150, "Flood (except ingress)", D.arp, 170)}
      {box(100, 210, "FDB lookup", D.cyan)}
      {box(330, 210, "Miss → flood", D.warning, 170)}
      {box(100, 270, "Hit: which port?", D.cyan)}
      {box(330, 270, "Other port → forward", D.success, 170)}
      {box(100, 330, "Ingress port → filter", D.faint, 170)}
      <DArrow x1={100} y1={47} x2={100} y2={72} color={D.muted} />
      <DArrow x1={100} y1={107} x2={100} y2={132} color={D.muted} />
      <DArrow x1={175} y1={150} x2={243} y2={150} color={D.arp} label="yes" />
      <DArrow x1={100} y1={167} x2={100} y2={192} color={D.muted} />
      <text x={110} y={184} fill={D.muted} fontSize={10} fontWeight={700}>
        no
      </text>
      <DArrow x1={175} y1={210} x2={243} y2={210} color={D.warning} label="no entry" />
      <DArrow x1={100} y1={227} x2={100} y2={252} color={D.muted} />
      <DArrow x1={175} y1={270} x2={243} y2={270} color={D.success} label="other port" />
      <DArrow x1={100} y1={287} x2={100} y2={312} color={D.faint} />
      <text x={110} y={304} fill={D.muted} fontSize={10} fontWeight={700}>
        same as ingress
      </text>
      <text x={180} y={30} fill={D.danger} fontSize={10}>
        bad FCS → discarded silently
      </text>
    </DiagramSvg>
  );
}

function AgingDiagram() {
  const x0 = 40;
  const scale = 1.5;
  const px = (t: number) => x0 + t * scale;
  return (
    <DiagramSvg h={190} label={`Aging in the lab: HOST-A, HOST-B and HOST-C learned at 0 s; HOST-A refreshed at 200 s; at 350 s HOST-B and HOST-C (350 s old) have expired, HOST-A (150 s old) remains; aging time ${FDB_AGING_SEC} s`}>
      <line x1={px(0)} y1={70} x2={px(350)} y2={70} stroke={D.line} strokeWidth={2} />
      {[0, 200, 300, 350].map((t) => (
        <g key={t}>
          <line x1={px(t)} y1={62} x2={px(t)} y2={78} stroke={D.muted} />
          <text x={px(t)} y={94} textAnchor="middle" fill={D.muted} fontSize={10} fontFamily="monospace">
            t={t} s
          </text>
        </g>
      ))}
      <DPill x={px(0)} y={42} text="A · B · C learned" color={D.success} />
      <DPill x={px(200)} y={42} text="A sends → A refreshed" color={D.cyan} />
      <DPill x={px(350)} y={42} text="check at t=350" color={D.warning} />
      <rect x={px(0)} y={112} width={FDB_AGING_SEC * scale} height={10} rx={5} fill={D.danger} fillOpacity={0.35} />
      <text x={px(0) + 4} y={140} fill={D.danger} fontSize={10}>
        B, C: last source at 0 s → {FDB_AGING_SEC} s window ends at 300 s → expired by 350 s
      </text>
      <rect x={px(200)} y={150} width={(350 - 200) * scale} height={10} rx={5} fill={D.success} fillOpacity={0.35} />
      <text x={px(200) - 130} y={178} fill={D.success} fontSize={10}>
        A: last source at 200 s → only 150 s old at 350 s → kept
      </text>
    </DiagramSvg>
  );
}

function RouterDiagram() {
  return (
    <DiagramSvg h={210} label="A switch forwards the same frame inside one LAN; a router ends the frame, forwards the IP packet between networks, and builds a new frame with new MAC addresses">
      <text x={20} y={22} fill={D.cyan} fontSize={11} fontWeight={800}>
        SWITCH (Layer 2) — same frame in and out
      </text>
      <DNode x={70} y={60} label="HOST-A" w={80} />
      <DNode x={320} y={60} label="SW1" accent={D.violet} w={70} />
      <DNode x={570} y={60} label="HOST-B" w={80} />
      <DArrow x1={112} y1={60} x2={283} y2={60} label={`dst …:0B · src …:0A`} />
      <DArrow x1={357} y1={60} x2={528} y2={60} label="dst …:0B · src …:0A (unchanged)" />
      <text x={20} y={122} fill={D.ip} fontSize={11} fontWeight={800}>
        ROUTER (Layer 3) — new frame per hop, same IP packet
      </text>
      <DNode x={70} y={165} label="HOST" w={80} />
      <DNode x={320} y={165} label="R" accent={D.ip} w={70} />
      <DNode x={570} y={165} label="HOST" w={80} />
      <DArrow x1={112} y1={165} x2={283} y2={165} color={D.ip} label="dst R-left · src M1" />
      <DArrow x1={357} y1={165} x2={528} y2={165} color={D.ip} label="dst M2 · src R-right" />
      <text x={320} y={200} textAnchor="middle" fill={D.muted} fontSize={10}>
        IP source/destination stay the same; TTL decrements (IPv4 lesson)
      </text>
    </DiagramSvg>
  );
}

// ------------------------------------------------------------------ knowledge checks

const QUIZ: KnowledgeQuestion[] = [
  { id: "q1", prompt: "HOST-A sends to HOST-B on a freshly booted SW1. What does SW1 learn from that one frame?", options: [{ id: "a", label: `${A} → ge-0/0/1` }, { id: "b", label: `${B} → ge-0/0/2` }, { id: "c", label: "Both" }, { id: "d", label: "Nothing yet" }], correctId: "a", explanation: "Only the SOURCE MAC, against the ingress port. The destination says who the frame is for, not where they are." },
  { id: "q2", prompt: "SW1 floods HOST-A's first frame. What destination MAC do the copies carry?", options: [{ id: "a", label: "FF:FF:FF:FF:FF:FF" }, { id: "b", label: `${B}` }, { id: "c", label: "Each port's own MAC" }], correctId: "b", explanation: "Flooding is a forwarding decision, not a rewrite. HOST-C discards its copy precisely because the destination is still HOST-B's MAC." },
  { id: "q3", prompt: "SW1 knows every host. Which frame is still flooded?", options: [{ id: "a", label: "A unicast to HOST-B" }, { id: "b", label: "A broadcast from HOST-C" }, { id: "c", label: "Neither" }], correctId: "b", explanation: "Unknown unicast stops once the destination is learned. A broadcast is addressed to everyone, so it is always flooded (never back out the ingress port)." },
  { id: "q4", prompt: "At t=200 s HOST-A sends to HOST-B. Whose entry is refreshed?", options: [{ id: "a", label: "HOST-A's" }, { id: "b", label: "HOST-B's" }, { id: "c", label: "Both" }], correctId: "a", explanation: "Only a frame a host SENDS refreshes its entry; being the destination does nothing to its timer." },
  { id: "q5", prompt: "HOST-B moves back to ge-0/0/2 and the link comes up. What does SW1 learn from the link-up?", options: [{ id: "a", label: "HOST-B → ge-0/0/2" }, { id: "b", label: "Nothing" }, { id: "c", label: "It flushes ge-0/0/4" }], correctId: "b", explanation: "A link event carries no source MAC. Only HOST-B's next frame (or aging, or clearing) changes the entry." },
  { id: "q6", prompt: "SW1 shows HOST-B on Gi1/0/4, but HOST-B is plugged into Gi1/0/2 and the port is connected. Best fix?", options: [{ id: "a", label: "Static entry HOST-B → Gi1/0/4" }, { id: "b", label: "Clear SW1's dynamic entry for HOST-B, then verify with traffic" }, { id: "c", label: "Fix HOST-A's ARP cache" }], correctId: "b", explanation: "It's a stale dynamic entry. Clearing it makes HOST-B unknown → flood reaches it → its reply relearns ge-0/0/2. A static entry would lock in the wrong port." },
];

// ------------------------------------------------------------------ content

export function EthernetDeepDiveContent() {
  const c1 = cli(LAB_T1, "cisco", `show mac address-table address ${ciscoMac(A)}`);
  const j1 = cli(LAB_T1, "juniper", "show ethernet-switching table");
  const c2 = cli(LAB_T2, "cisco", "show mac address-table");
  const cAging = cli(LAB_AGED, "cisco", "show mac address-table aging-time");
  const cAged = cli(LAB_AGED, "cisco", "show mac address-table");
  const cMovedStatus = cli(LAB_MOVED, "cisco", "show interfaces status");
  const jMovedTerse = cli(LAB_MOVED, "juniper", "show interfaces terse");
  const cDesk = cli(LAB_DESK, "cisco", "show mac address-table interface Gi1/0/4");
  const cStaleAddr = cli(LAB_STALE, "cisco", `show mac address-table address ${ciscoMac(B)}`);
  const cStaleStatus = cli(LAB_STALE, "cisco", "show interfaces status");
  const cStale2 = cli(LAB_STALE, "cisco", "show mac address-table interface Gi1/0/2");
  const jStale = cli(LAB_STALE, "juniper", "show ethernet-switching table interface ge-0/0/4");
  const cFixed = cli(LAB_FIXED, "cisco", `show mac address-table address ${ciscoMac(B)}`);

  return (
    <div className="space-y-12">
      {/* ------------------------------------------------------------ Foundation */}
      <GuideSection id="ethd-why" eyebrow="Foundation" title="Why Ethernet switching exists" tone="ethernet">
        <p>
          Three hosts and a hot-desk switch share one LAN. Every frame needs to reach <Strong>one</Strong> host — HOST-B, say — without bothering the others. A switch makes that possible <Strong>without anyone configuring it</Strong>: it works out where every host is from the frames themselves.
        </p>
        <CompareCards
          items={[
            { title: "Without a learning switch", tone: "warning", tag: "every frame everywhere", points: ["A shared medium (or a hub) repeats every frame out every port", "Every host must look at every frame", "Bandwidth is shared by everyone"] },
            { title: "With SW1", tone: "success", tag: "frames go where needed", points: ["Known destinations get one port only", "Unknown destinations are found by flooding — once", "Each port is its own link; HOST-C never sees HOST-A ↔ HOST-B traffic once learned"] },
          ]}
        />
        <DiagramFrame caption="The network used everywhere in this lesson: the guided lesson, this guide and the Ethernet Lab.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ethd-model" eyebrow="Mental model" title="A learning bridge is an honest note-taker" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Write down the sender", body: "Every frame that enters a port proves one fact: its SOURCE MAC is reachable through that port.", tone: "warning" },
            { title: "Look up the receiver", body: "The DESTINATION MAC is looked up in the notes (the FDB).", tone: "cyan" },
            { title: "Act on the notes", body: "Note found on another port → send it there only. No note → ask everyone (flood). Destination means everyone → flood.", tone: "success" },
            { title: "Notes age", body: `A note not refreshed by the host's own frames for ${FDB_AGING_SEC} s is thrown away. A note can also be wrong if the host moved.`, tone: "danger" },
          ]}
        />
        <Callout tone="ethernet" title="The one rule">
          A switch <Strong>learns</Strong> from the source MAC and <Strong>forwards</Strong> by the destination MAC. Everything in this lesson follows from that.
        </Callout>
      </GuideSection>

      {/* ------------------------------------------------------------ The frame */}
      <GuideSection id="ethd-frame" eyebrow="IEEE 802.3" title="Ethernet II frame anatomy" tone="ethernet">
        <DiagramFrame caption="The preamble and SFD sync the receiver and are not part of the frame. The FCS covers destination through payload.">
          <FrameDiagram />
        </DiagramFrame>
        <PacketAnatomy
          title="HOST-A → HOST-B, as it enters SW1 on ge-0/0/1"
          layers={[
            {
              name: "Ethernet II header",
              tone: "ethernet",
              note: "read by SW1",
              fields: [
                { name: "Destination MAC", value: B, why: "Who the frame is for — HOST-B. SW1 looks this up to decide where to send it.", key: true },
                { name: "Source MAC", value: A, why: "Who sent it — HOST-A. SW1 learns this against ge-0/0/1.", key: true },
                { name: "EtherType", value: "0x0800 (IPv4)", why: "What the payload is. 0x0806 would be ARP (HOST-C's broadcast later)." },
              ],
            },
            { name: "Payload", tone: "ip", note: "carried, never read by SW1", fields: [{ name: "Carries", value: "IPv4 packet", why: "A switch doesn't look inside — routing is a different lesson." }] },
            { name: "Trailer", tone: "ethernet", fields: [{ name: "FCS", value: "CRC-32 over the frame", why: "SW1 checks it on receive; a frame with a bad FCS is discarded and never learned from." }] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ethd-mac" eyebrow="Addressing" title="What a MAC address encodes" tone="violet">
        <DiagramFrame caption="The two low bits of the first octet mark group vs individual and local vs universal administration.">
          <MacDiagram />
        </DiagramFrame>
        <p>
          A source MAC is always an individual address. A switch never learns <Mono>{BROADCAST_MAC}</Mono> or a multicast address, because those can never appear as a sender. In the lesson: HOST-A <Mono>{A}</Mono>, HOST-B <Mono>{B}</Mono>, HOST-C <Mono>{C}</Mono> — Cisco prints them as <Mono>{ciscoMac(A)}</Mono>, Junos as <Mono>{A.toLowerCase()}</Mono>.
        </p>
      </GuideSection>

      {/* ------------------------------------------------------------ The switch decides */}
      <GuideSection id="ethd-learn" eyebrow="Step 1" title="Source learning" tone="warning">
        <KnowledgeCheck question={{ id: "p-learn", prompt: "Before reading on: SW1 receives HOST-A → HOST-B on ge-0/0/1. What does it write down?", options: [{ id: "a", label: "HOST-A → ge-0/0/1" }, { id: "b", label: "HOST-B → ge-0/0/2" }, { id: "c", label: "Both" }], correctId: "a", explanation: "The frame proves where its SENDER is. It proves nothing about where the destination is." }} />
        <DiagramFrame caption="The frame arrives on ge-0/0/1 (amber). SW1 records the SOURCE against that port before anything else.">
          <FirstFrameDiagram />
        </DiagramFrame>
        <FieldTable title="What a source frame does to the table" columns={["Situation", "Effect"]} rows={[["MAC not in table", "Learned against the ingress port"], ["MAC already on this port", "Refreshed (age back to 0)"], ["MAC known on a different port", "Moved to the ingress port"]]} />
      </GuideSection>

      <GuideSection id="ethd-lookup" eyebrow="Step 2" title="Destination lookup" tone="cyan">
        <p>
          After learning, SW1 looks up the destination <Mono>{B}</Mono>. On the first frame there is <Strong>no entry</Strong> — HOST-B has never sent anything — so SW1 cannot choose one port. That is a <Strong>miss</Strong>, and a miss means flood.
        </p>
        <StateTransition
          states={[
            { label: "Frame in on ge-0/0/1", tone: "ethernet" },
            { label: "Learn source", detail: <>{A} → ge-0/0/1</>, tone: "warning" },
            { label: "Look up destination", detail: <>{B}: no entry</>, tone: "cyan" },
            { label: "Decide", detail: "unknown unicast → flood", tone: "danger" },
          ]}
        />
      </GuideSection>

      <GuideSection id="ethd-decision" eyebrow="IEEE 802.1D" title="Flood, forward or filter" tone="cyan">
        <DiagramFrame caption="Every frame takes the same path. Learning always happens before the forwarding decision.">
          <DecisionDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Forward", tone: "success", tag: "lookup hit, other port", points: ["Out that one port only", "HOST-B → HOST-A after the first reply"] },
            { title: "Flood", tone: "warning", tag: "miss or broadcast", points: ["Out every other up port", "Never back out the ingress port"] },
            { title: "Filter", tone: "violet", tag: "hit on the ingress port", points: ["Destination is behind the port the frame came in on", "Nothing is sent"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ethd-bum" eyebrow="Two kinds of flood" title="Unknown unicast vs broadcast" tone="arp">
        <DiagramFrame caption="Both are flooded out every port except the ingress port — for different reasons.">
          <BroadcastVsUnknownDiagram />
        </DiagramFrame>
        <p>
          HOST-C&apos;s broadcast (EtherType <Mono>0x0806</Mono>, an ARP request) is flooded even though SW1 knows every host. SW1 still learns <Mono>{C} → ge-0/0/3</Mono> from its source, and HOST-C gets <Strong>no copy back</Strong>: the ingress port is excluded.
        </p>
      </GuideSection>

      <GuideSection id="ethd-nic" eyebrow="At the host" title="Host NIC filtering" tone="success">
        <FieldTable
          title="Who keeps the first, flooded HOST-A → HOST-B frame?"
          columns={["Receiver", "Destination vs own MAC", "Result"]}
          rows={[
            ["HOST-B", `${B} = ${B}`, "accepted — passed up"],
            ["HOST-C", `${B} ≠ ${C}`, "discarded by the NIC"],
            ["DESK-SW", "a switch, not a host", "bridges it: learns HOST-A on port 1; nothing on port 2 → goes no further"],
          ]}
        />
        <p>A broadcast is accepted by every host that receives it. Flooding wastes a little bandwidth; it never delivers data to the wrong application, because NICs filter on the destination MAC.</p>
      </GuideSection>

      {/* ------------------------------------------------------------ State over time */}
      <GuideSection id="ethd-fdb" eyebrow="State" title="The FDB (MAC table)" tone="cyan">
        <DiagramFrame caption="HOST-B's reply teaches SW1 the reverse direction. HOST-A is already known, so only ge-0/0/1 is used.">
          <ReplyDiagram />
        </DiagramFrame>
        <FieldTable title="One FDB entry" columns={["Field", "Meaning"]} rows={[["MAC", "A source MAC SW1 has seen"], ["Port", "The port it was seen on — the direction to that MAC"], ["Type", "dynamic (learned) · static (configured, never in this lesson)"], ["Age", `seconds since that MAC last SENT a frame; removed after ${FDB_AGING_SEC} s`]]} />
      </GuideSection>

      <GuideSection id="ethd-transitions" eyebrow="State transitions" title="Before and after, frame by frame" tone="violet">
        <div className="grid gap-3 sm:grid-cols-2">
          <FieldTable title="T0 · freshly booted" columns={["MAC", "Port", "Type", "Age"]} rows={fdbRows(LAB_T0)} />
          <FieldTable title="T1 · after HOST-A → HOST-B" columns={["MAC", "Port", "Type", "Age"]} rows={fdbRows(LAB_T1)} />
          <FieldTable title="T2 · after HOST-B → HOST-A" columns={["MAC", "Port", "Type", "Age"]} rows={fdbRows(LAB_T2)} />
          <FieldTable title="T4 · after HOST-C's broadcast" columns={["MAC", "Port", "Type", "Age"]} rows={fdbRows(LAB_T4)} />
        </div>
        <p>These four tables are produced by the Ethernet Lab&apos;s own model — run the same frames in the lab and you will see exactly these rows.</p>
      </GuideSection>

      <GuideSection id="ethd-aging" eyebrow="Time" title="Aging" tone="warning">
        <DiagramFrame caption={`IEEE 802.1D recommends a ${FDB_AGING_SEC} s default aging time. Only a frame the host sends restarts its timer.`}>
          <AgingDiagram />
        </DiagramFrame>
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel {...cAging} caption="Cisco: the aging time" />
          <CliPanel {...cAged} caption="Cisco: t=350 s — only HOST-A remains" />
        </div>
        <p>Aging keeps the table small and self-healing: a host that moved silently is reached again once its old entry expires, because frames to it are flooded again.</p>
      </GuideSection>

      <GuideSection id="ethd-move" eyebrow="Movement" title="Host movement" tone="violet">
        <DiagramFrame caption="HOST-B moves to DESK-SW. SW1 finds the new location only from HOST-B's own frame — on ge-0/0/4.">
          <MoveDiagram />
        </DiagramFrame>
        <CliPanel {...cDesk} caption="Cisco: after HOST-B speaks from the hot desk — HOST-B is behind the DESK-SW uplink" />
      </GuideSection>

      <GuideSection id="ethd-flush" eyebrow="Link events" title="Link-down flush" tone="danger">
        <p>
          When HOST-B was unplugged, ge-0/0/2 went <Strong>down</Strong> and SW1 flushed the dynamic entries learned on it — HOST-B vanished from the table. That is common managed-switch behavior: a MAC learned on a dead port can no longer be reached there.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel {...cMovedStatus} caption="Cisco: Gi1/0/2 notconnect after the unplug" />
          <CliPanel {...jMovedTerse} caption="Junos: ge-0/0/2 link down" />
        </div>
      </GuideSection>

      <GuideSection id="ethd-linkup" eyebrow="Link events" title="Why link-up teaches nothing" tone="danger">
        <Callout tone="warning" title="A link coming up carries no source MAC">
          When HOST-B was plugged back into ge-0/0/2, the port came up — but a link-up event contains no frame, so SW1 learned <Strong>nothing</Strong>. And DESK-SW&apos;s uplink ge-0/0/4 never went down, so nothing learned there was flushed.
        </Callout>
        <StateTransition
          states={[
            { label: "Learned behind ge-0/0/4", detail: "while HOST-B sat at the hot desk", tone: "violet" },
            { label: "ge-0/0/4 stays up", detail: "no flush", tone: "warning" },
            { label: "ge-0/0/2 comes up", detail: "no frame → no learning", tone: "warning" },
            { label: "HOST-B silent", detail: "no new source frame", tone: "danger" },
          ]}
        />
      </GuideSection>

      <GuideSection id="ethd-stale" eyebrow="Wrong state" title="Stale entries" tone="danger">
        <DiagramFrame caption="The FDB is confidently wrong. SW1 forwards correctly according to its table; the table is out of date.">
          <StaleDiagram />
        </DiagramFrame>
        <p>A stale entry is dangerous because nothing looks broken: links are up, the frame is correctly addressed, SW1 forwards it as known unicast — out the wrong port. It ends when HOST-B sends any frame on ge-0/0/2, when the entry ages out, or when it is cleared.</p>
      </GuideSection>

      <GuideSection id="ethd-domain" eyebrow="Scope" title="Broadcast domains" tone="arp">
        <p>
          SW1, DESK-SW and the three hosts form <Strong>one broadcast domain</Strong>: a broadcast from any host reaches every other host, through both switches. DESK-SW extends the domain; it does not split it. Only a router (or a VLAN — a later lesson) ends a broadcast domain.
        </p>
      </GuideSection>

      <GuideSection id="ethd-managed" eyebrow="Devices" title="Managed vs unmanaged switches" tone="violet">
        <CompareCards
          items={[
            { title: "SW1 — managed", tone: "cyan", tag: "has a CLI", points: ["Learns, floods and forwards like any bridge", "Its table and ports can be inspected (Cisco or Junos CLI)", "Entries can be cleared; aging time is configurable"] },
            { title: "DESK-SW — unmanaged", tone: "warning", tag: "no management plane", points: ["Still a learning bridge with its own table", "Nothing to log into — you can't see its table", "Problems behind it are inferred from SW1 and the hosts"] },
          ]}
        />
        <p>That is why the Ethernet Lab shows DESK-SW&apos;s table only as a <Strong>simulation view</Strong> — on a real network you would never see it.</p>
      </GuideSection>

      {/* ------------------------------------------------------------ Operations */}
      <GuideSection id="ethd-cli" eyebrow="Operations" title="Verifying SW1 on Cisco and Junos" tone="cyan">
        <FieldTable
          title="Every command answers an engineering question"
          columns={["Question", "Cisco IOS", "Junos"]}
          rows={[
            ["What MACs does SW1 know?", <Mono key="c">show mac address-table</Mono>, <Mono key="j">show ethernet-switching table</Mono>],
            ["Where was this MAC learned?", <Mono key="c">show mac address-table address H.H.H</Mono>, "read it in the table"],
            ["What is behind this port?", <Mono key="c">show mac address-table interface Gi1/0/2</Mono>, <Mono key="j">show ethernet-switching table interface ge-0/0/2</Mono>],
            ["How long do entries live?", <Mono key="c">show mac address-table aging-time</Mono>, "—"],
            ["Is the port up?", <Mono key="c">show interfaces status</Mono>, <Mono key="j">show interfaces terse</Mono>],
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel {...c1} caption="Cisco · T1: where is HOST-A?" />
          <CliPanel {...j1} caption="Junos · T1: the whole table" />
        </div>
        <CliPanel {...c2} caption="Cisco · T2: after HOST-B's reply" />
        <Callout tone="cyan" title="Port names">
          Cisco calls SW1&apos;s ports <Mono>Gi1/0/1</Mono>–<Mono>Gi1/0/4</Mono>; this lesson and Junos call the same ports <Mono>ge-0/0/1</Mono>–<Mono>ge-0/0/4</Mono>. This lesson has no VLANs, so Cisco shows VLAN 1 and Junos shows <Mono>default</Mono>.
        </Callout>
      </GuideSection>

      <GuideSection id="ethd-ifstate" eyebrow="Operations" title="Interface state" tone="cyan">
        <p>
          Check the port before blaming the table: a MAC can only be learned on a port that is up. But an up port proves only that the cable works — not which MACs are behind it. Port <Strong>descriptions</Strong> (<Mono>HOST-B</Mono>) are intent typed by a person; the MAC table is what the switch actually saw.
        </p>
        <CliPanel {...cStaleStatus} caption="Cisco: every port connected — yet HOST-A can't reach HOST-B" />
      </GuideSection>

      <GuideSection id="ethd-workflow" eyebrow="Troubleshooting" title="Troubleshooting from evidence" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Symptom — what exactly fails?", look: "HOST-A → HOST-B is lost; reproduce it before changing anything." },
            { question: "Observation — what do the devices report?", look: "No errors anywhere; SW1 forwards it as known unicast (one port)." },
            { question: "Evidence — what does the state say?", look: <>MAC table for HOST-B · interface status · where HOST-B is physically plugged in.</> },
            { question: "Hypothesis — what single cause fits ALL the evidence?", look: "The table and the cabling disagree → stale entry. (Not ARP, not the cable, not a changed MAC.)" },
            { question: "Test — what observation proves it?", look: <>Table says ge-0/0/4 (Gi1/0/4); HOST-B is on ge-0/0/2, which is up and has no MACs behind it.</> },
            { question: "Root cause — why did it happen?", look: "Learned at the hot desk; ge-0/0/4 never went down; link-up teaches nothing; HOST-B silent since." },
            { question: "Repair — smallest change that fixes the cause", look: "Clear SW1's dynamic entry for HOST-B." },
            { question: "Verify — prove it with traffic and state", look: "Flood reaches HOST-B → its reply relearns ge-0/0/2 → known unicast → table shows Gi1/0/2." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ethd-failures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "A", title: "Frames to one host vanish, no errors", tone: "danger", points: ["MAC table points to a port the host isn't on", "Typical after a host move behind another switch", "→ stale dynamic entry"] },
            { tag: "B", title: "One host's traffic is flooded every time", tone: "warning", points: ["Its MAC never appears in the table", "It never sends (silent receiver), or its frames never reach the switch", "→ check whether that host ever transmits"] },
            { tag: "C", title: "A host reachable, then not, then reachable", tone: "warning", points: ["Its entry keeps moving between ports", "→ two paths to it (a loop — Switching Fundamentals)"] },
            { tag: "D", title: "Port down, host unreachable", tone: "violet", points: ["show interfaces status: notconnect", "Entries on that port flushed", "→ physical layer first"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ethd-incident" eyebrow="Case study" title="The DESK-SW stale-entry incident" tone="danger">
        <p>The same evidence you will gather in the lab, produced by the lab&apos;s model at the moment of the incident:</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <CliPanel {...cStaleAddr} caption="1 · Where does SW1 think HOST-B is?" />
          <CliPanel {...cStale2} caption="2 · What is behind HOST-B's real port?" />
        </div>
        <CliPanel {...jStale} caption="Junos view of the same evidence" />
        <Callout tone="danger" title="Conclusion">
          SW1 has HOST-B behind ge-0/0/4 (Gi1/0/4) while HOST-B is plugged into ge-0/0/2 (up, nothing learned there). The entry is stale. Clear it, then verify with traffic:
        </Callout>
        <CliPanel {...cFixed} caption="After the repair and verification traffic" />
        <LabBridge label="Troubleshoot it in the Ethernet Lab">Create this incident yourself, gather the evidence on SW1&apos;s CLI and fix it.</LabBridge>
      </GuideSection>

      <GuideSection id="ethd-myths" eyebrow="Troubleshooting" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "A switch learns where the destination is.", correction: "It learns only the SOURCE, against the ingress port." },
            { myth: "Flooding turns a frame into a broadcast.", correction: <>The destination stays <Mono>{B}</Mono>; only the forwarding changes.</> },
            { myth: "A full table stops all flooding.", correction: "Broadcasts are always flooded; only unknown unicast stops once learned." },
            { myth: "Plugging a host in teaches the switch its MAC.", correction: "Only a frame the host sends does. A link-up event carries no MAC." },
            { myth: "If every link is up, the switch can't be the problem.", correction: "A stale table entry forwards perfectly — to the wrong port." },
            { myth: "Switches use ARP to forward frames.", correction: "Switches forward on MAC addresses using the FDB. ARP is a host/router IP→MAC mechanism." },
          ]}
        />
      </GuideSection>

      {/* ------------------------------------------------------------ Advanced */}
      <GuideSection id="ethd-router" eyebrow="Layers" title="Switch vs router" tone="ip">
        <DiagramFrame caption="SW1 never touches the frame. A router replaces the Ethernet header on every hop.">
          <RouterDiagram />
        </DiagramFrame>
      </GuideSection>

      {/* ------------------------------------------------------------ Master it */}
      <GuideSection id="ethd-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="ethd-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: "What does SW1 actually do to a frame from HOST-A to HOST-B?", a: "Checks the FCS, learns HOST-A's MAC against the ingress port, looks up HOST-B's MAC, then forwards it out one port (hit), floods it (miss) or filters it (hit on the ingress port). It never changes the frame." },
            { q: "Why was HOST-A's first frame flooded but the second wasn't?", a: "The first lookup missed: HOST-B had never sent a frame. HOST-B's reply taught SW1 that HOST-B is on ge-0/0/2, so the next lookup hit." },
            { q: "Why can an entry be wrong while every link is up?", a: "Entries change only on source frames, link-down flushes, aging or clearing. A host that moves behind a port that stays up and then stays silent leaves its old entry behind." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ethd-practice" eyebrow="Practice" title="Practice in the Ethernet Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={["Predict, then watch SW1 learn and flood the first frame (three copies at once)", "Turn unknown unicast into known unicast with one reply", "Flood a broadcast and see why a full table doesn't stop it", "Age entries out with the lab clock", "Move HOST-B, create a stale entry, and troubleshoot it on SW1's CLI", "Repair it — and prove the repair with traffic"]}
        />
        <LabBridge label="Open the Ethernet Lab">Same network, your own copy of it. Nothing you do there changes your lesson progress.</LabBridge>
      </GuideSection>
    </div>
  );
}
