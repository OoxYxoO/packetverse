import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, DPill, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { DSpokeLegend, DSwitchStar, DTable, type SpokeMode } from "@/components/lesson/FundamentalsGuideSvg";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { BROADCAST_MAC, ETH_MAC, FDB_AGING_SEC } from "@/lib/sim-engine/scenarios/ethernetSwitching";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { ciscoMac } from "@/lib/cli/format";
import type { CliVendor } from "@/lib/cli/types";
import { createEthLabState, ETH_TICKETS, runInstant, type EthLabAction, type EthLabState } from "@/lib/sim-engine/scenarios/ethernetLab";
import { ethSw1CliSets, type EthCliApi } from "./ethernet-lab/ethLabCli";

export const ETH_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "eth-mission", label: "What this lesson teaches" },
  { id: "eth-network", label: "The network of this lesson" },
  { id: "eth-ideas", label: "Three ideas you need" },
  { id: "eth-walk", label: "What you will watch" },
  { id: "eth-frame", label: "A frame carries two MACs" },
  { id: "eth-first", label: "The first frame: learn, then flood" },
  { id: "eth-reply", label: "The reply: one port only" },
  { id: "eth-broadcast", label: "A broadcast floods on purpose" },
  { id: "eth-aging", label: "A quiet host is forgotten" },
  { id: "eth-move", label: "HOST-B moves to the hot desk" },
  { id: "eth-verify", label: "What working looks like" },
  { id: "eth-incident", label: "The incident" },
  { id: "eth-investigate", label: "Follow the frame, not the lights" },
  { id: "eth-repair", label: "Repair and prove it" },
  { id: "eth-other", label: "Other ways the table goes wrong" },
  { id: "eth-model", label: "Mental model" },
  { id: "eth-glossary", label: "Glossary" },
  { id: "eth-recap", label: "Recap" },
  { id: "eth-practice", label: "Practice it" },
];

const A = ETH_MAC["HOST-A"];
const B = ETH_MAC["HOST-B"];
const C = ETH_MAC["HOST-C"];
const short = (m: string) => `…${m.slice(-5)}`;
const FDB_COLS = [
  { label: "MAC", w: 132 },
  { label: "PORT", w: 70 },
  { label: "TYPE", w: 62 },
];

/** SW1 in the middle; `modes` colors each link for one frame. */
function Star({ modes, bOnDesk, subs }: { modes: Partial<Record<"A" | "B" | "C" | "D", SpokeMode>>; bOnDesk?: boolean; subs?: Partial<Record<"SW", string>> }) {
  return (
    <DSwitchStar
      sw={{ x: 200, y: 120, label: "SW1", sub: subs?.SW }}
      spokes={[
        { id: "a", x: 60, y: 40, label: "HOST-A", sub: short(A), port: "ge-0/0/1", mode: modes.A ?? "idle" },
        { id: "c", x: 60, y: 200, label: "HOST-C", sub: short(C), port: "ge-0/0/3", mode: modes.C ?? "idle" },
        { id: "b", x: 340, y: 40, label: bOnDesk ? "(empty)" : "HOST-B", sub: bOnDesk ? "port down" : short(B), port: "ge-0/0/2", mode: bOnDesk ? "down" : (modes.B ?? "idle") },
        { id: "d", x: 340, y: 200, label: bOnDesk ? "DESK-SW + HOST-B" : "DESK-SW", sub: bOnDesk ? `B on port 2` : "free port", port: "ge-0/0/4", mode: modes.D ?? "idle", w: bOnDesk ? 132 : 104 },
      ]}
    />
  );
}

export function TopologyDiagram() {
  return (
    <DiagramSvg h={250} label="SW1 with HOST-A on ge-0/0/1, HOST-B on ge-0/0/2, HOST-C on ge-0/0/3 and the unmanaged DESK-SW on ge-0/0/4; all one broadcast domain">
      <Star modes={{}} subs={{ SW: "FDB empty" }} />
      <text x={440} y={60} fill={D.muted} fontSize={10.5}>
        HOST-A {A}
      </text>
      <text x={440} y={80} fill={D.muted} fontSize={10.5}>
        HOST-B {B}
      </text>
      <text x={440} y={100} fill={D.muted} fontSize={10.5}>
        HOST-C {C}
      </text>
      <text x={440} y={130} fill={D.text} fontSize={10.5} fontWeight={700}>
        One broadcast domain
      </text>
      <text x={440} y={148} fill={D.muted} fontSize={10}>
        SW1 starts with an empty FDB.
      </text>
      <text x={440} y={166} fill={D.muted} fontSize={10}>
        DESK-SW is a small unmanaged
      </text>
      <text x={440} y={180} fill={D.muted} fontSize={10}>
        switch with one free port.
      </text>
    </DiagramSvg>
  );
}

export function FirstFrameDiagram() {
  return (
    <DiagramSvg w={700} h={270} label={`HOST-A to HOST-B: SW1 learns ${A} on ge-0/0/1, misses ${B}, floods out ge-0/0/2, ge-0/0/3 and ge-0/0/4 with the destination MAC unchanged`}>
      <Star modes={{ A: "in", B: "out", C: "out", D: "out" }} subs={{ SW: "learn + flood" }} />
      <DTable x={420} y={20} title="SW1 FDB after this frame" cols={FDB_COLS} rows={[[A, "ge-0/0/1", "dynamic"]]} highlight={{ row: 0, color: D.success }} />
      <text x={420} y={120} fill={D.warning} fontSize={10.5} fontWeight={700}>
        1 · learn SOURCE {short(A)} on ge-0/0/1
      </text>
      <text x={420} y={140} fill={D.danger} fontSize={10.5} fontWeight={700}>
        2 · lookup {short(B)} → miss
      </text>
      <text x={420} y={160} fill={D.cyan} fontSize={10.5} fontWeight={700}>
        3 · flood all ports except ge-0/0/1
      </text>
      <text x={420} y={184} fill={D.muted} fontSize={10}>
        every copy: dst {B}
      </text>
      <text x={420} y={204} fill={D.muted} fontSize={10}>
        HOST-B accepts · HOST-C discards
      </text>
      <DSpokeLegend x={20} y={260} />
    </DiagramSvg>
  );
}

export function ReplyDiagram() {
  return (
    <DiagramSvg w={700} h={270} label={`HOST-B replies: SW1 learns ${B} on ge-0/0/2 and forwards to HOST-A out ge-0/0/1 only`}>
      <Star modes={{ B: "in", A: "out" }} subs={{ SW: "known unicast" }} />
      <DTable
        x={420}
        y={20}
        title="SW1 FDB after the reply"
        cols={FDB_COLS}
        rows={[
          [A, "ge-0/0/1", "dynamic"],
          [B, "ge-0/0/2", "dynamic"],
        ]}
        highlight={{ row: 1, color: D.success }}
      />
      <text x={420} y={140} fill={D.cyan} fontSize={10.5} fontWeight={700}>
        lookup {short(A)} → ge-0/0/1 (hit)
      </text>
      <text x={420} y={160} fill={D.muted} fontSize={10}>
        one egress port — HOST-C and DESK-SW
      </text>
      <text x={420} y={174} fill={D.muted} fontSize={10}>
        never see this frame.
      </text>
      <DSpokeLegend x={20} y={260} />
    </DiagramSvg>
  );
}

export function BroadcastVsUnknownDiagram() {
  return (
    <DiagramSvg h={250} w={640} label="Unknown unicast: destination is a unicast MAC missing from the FDB, flooded until learned. Broadcast: destination FF:FF:FF:FF:FF:FF, always flooded">
      {[
        { x: 20, title: "UNKNOWN UNICAST", color: D.warning, dst: B, why: "lookup MISSED", stops: "stops once the MAC is learned", who: "only HOST-B accepts" },
        { x: 330, title: "BROADCAST", color: D.arp, dst: BROADCAST_MAC, why: "addressed to ALL", stops: "floods no matter what the FDB holds", who: "every host accepts" },
      ].map((p) => (
        <g key={p.title}>
          <rect x={p.x} y={16} width={290} height={210} rx={12} fill={D.box} stroke={p.color} strokeOpacity={0.6} />
          <text x={p.x + 16} y={40} fill={p.color} fontSize={12} fontWeight={800}>
            {p.title}
          </text>
          <text x={p.x + 16} y={66} fill={D.faint} fontSize={9.5} fontWeight={700}>
            DESTINATION MAC
          </text>
          <text x={p.x + 16} y={84} fill={D.text} fontSize={12} fontFamily="monospace">
            {p.dst}
          </text>
          <text x={p.x + 16} y={112} fill={D.faint} fontSize={9.5} fontWeight={700}>
            WHY IT FLOODS
          </text>
          <text x={p.x + 16} y={130} fill={D.text} fontSize={11}>
            {p.why}
          </text>
          <text x={p.x + 16} y={158} fill={D.faint} fontSize={9.5} fontWeight={700}>
            WHEN IT STOPS
          </text>
          <text x={p.x + 16} y={176} fill={D.text} fontSize={11}>
            {p.stops}
          </text>
          <DPill x={p.x + 145} y={204} text={p.who} color={p.color} />
        </g>
      ))}
    </DiagramSvg>
  );
}

export function MoveDiagram() {
  return (
    <DiagramSvg w={700} h={290} label="HOST-B moves from ge-0/0/2 to DESK-SW: ge-0/0/2 goes down and its entries are flushed; SW1 relearns HOST-B on ge-0/0/4 only when HOST-B sends a frame">
      <Star modes={{ D: "in", A: "out" }} bOnDesk subs={{ SW: "relearn" }} />
      <DTable
        x={420}
        y={16}
        title="1 · after the move (ge-0/0/2 down)"
        cols={FDB_COLS}
        rows={[[A, "ge-0/0/1", "dynamic"]]}
      />
      <DTable
        x={420}
        y={110}
        title="2 · after HOST-B sends from DESK-SW"
        cols={FDB_COLS}
        rows={[
          [A, "ge-0/0/1", "dynamic"],
          [B, "ge-0/0/4", "dynamic"],
        ]}
        highlight={{ row: 1, color: D.success }}
      />
      <text x={420} y={232} fill={D.muted} fontSize={10}>
        No frame from HOST-B = no new entry.
      </text>
      <text x={420} y={248} fill={D.muted} fontSize={10}>
        A link event never teaches a location.
      </text>
      <DSpokeLegend x={20} y={280} />
    </DiagramSvg>
  );
}

export function StaleDiagram() {
  return (
    <DiagramSvg w={700} h={290} label={`Incident: HOST-B is back on ge-0/0/2 but SW1's dynamic entry still says ${B} is on ge-0/0/4 (that link never went down), so known-unicast frames go to DESK-SW and are lost`}>
      <DSwitchStar
        sw={{ x: 200, y: 120, label: "SW1", sub: "known unicast" }}
        spokes={[
          { id: "a", x: 60, y: 40, label: "HOST-A", sub: short(A), port: "ge-0/0/1", mode: "in" },
          { id: "c", x: 60, y: 200, label: "HOST-C", sub: short(C), port: "ge-0/0/3", mode: "idle" },
          { id: "b", x: 340, y: 40, label: "HOST-B", sub: "silent since plug-in", port: "ge-0/0/2", mode: "idle", w: 128 },
          { id: "d", x: 340, y: 200, label: "DESK-SW", sub: "port 2 empty", port: "ge-0/0/4", mode: "out" },
        ]}
      />
      <DTable
        x={420}
        y={16}
        title="SW1 FDB (stale)"
        cols={FDB_COLS}
        rows={[
          [A, "ge-0/0/1", "dynamic"],
          [B, "ge-0/0/4", "dynamic"],
        ]}
        highlight={{ row: 1, color: D.danger }}
      />
      <text x={420} y={130} fill={D.danger} fontSize={10.5} fontWeight={700}>
        entry says ge-0/0/4 · HOST-B is on ge-0/0/2
      </text>
      <text x={420} y={150} fill={D.muted} fontSize={10}>
        ge-0/0/4 stayed UP → no flush
      </text>
      <text x={420} y={166} fill={D.muted} fontSize={10}>
        HOST-B has not sourced a frame
      </text>
      <text x={420} y={194} fill={D.success} fontSize={10.5} fontWeight={700}>
        fix: clear the stale dynamic entry
      </text>
      <text x={420} y={210} fill={D.muted} fontSize={10}>
        → flood → reply → relearn ge-0/0/2
      </text>
      <DSpokeLegend x={20} y={280} />
    </DiagramSvg>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Ethernet Lab" onPractice={openLab}>
      Same network, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The Ethernet Lab's own SW1 command sets, run against lab states: what this page shows is what the lab prints. */
function lessonCli(s: EthLabState, vendor: CliVendor, command: string) {
  const api: EthCliApi = { lab: s, act: () => undefined, cisco: { kind: "exec" }, setCisco: () => undefined, junosMode: "op", setJunosMode: () => undefined, cand: s.cfg, setCand: () => undefined, hist: [{ cfg: s.cfg, at: 0, by: "root" }], commit: () => undefined };
  return runGuideCli(ethSw1CliSets(api)[vendor], command);
}
const playLab = (s: EthLabState, actions: EthLabAction[]) => actions.reduce(runInstant, s);
const sendLab = (src: "HOST-A" | "HOST-B" | "HOST-C", dst: "HOST-A" | "HOST-B" | "HOST-C" | "broadcast"): EthLabAction => ({ type: "send", src, dst });
/** A→B, B→A and HOST-C's broadcast: every host learned on its own port. */
const HEALTHY = playLab(createEthLabState(), [sendLab("HOST-A", "HOST-B"), sendLab("HOST-B", "HOST-A"), sendLab("HOST-C", "broadcast")]);
/** The lab's "stale" ticket, then HOST-A tries HOST-B. */
const STALE = playLab(createEthLabState(), [...ETH_TICKETS.stale.setup, sendLab("HOST-A", "HOST-B")]);
/** Clear the one entry, then the fresh test: flood, reply, known unicast. */
const FIXED = playLab(STALE, [{ type: "clear", mac: B }, sendLab("HOST-A", "HOST-B"), sendLab("HOST-B", "HOST-A"), sendLab("HOST-A", "HOST-B")]);

export function EthernetLessonGuideContent() {
  const tableOk = lessonCli(HEALTHY, "cisco", "show mac address-table");
  const tableBad = lessonCli(STALE, "cisco", "show mac address-table");
  const statusBad = lessonCli(STALE, "cisco", "show interfaces status");
  const tableFixed = lessonCli(FIXED, "cisco", "show mac address-table");
  const junosBad = lessonCli(STALE, "juniper", "show ethernet-switching table");
  const rows = /Vlan|----|DYNAMIC|STATIC|Total/;
  const junosRows = /Vlan|name|default|entries/;
  return (
    <div className="space-y-12">
      <GuideSection id="eth-mission" eyebrow="This lesson" title="What this lesson teaches" tone="ethernet">
        <p>
          Three computers and a small desk switch are cabled to one switch, SW1. Every frame they send names the computer it is for, by MAC address, and SW1 must deliver it to the right port. Nobody tells SW1 where anyone is: it has to work that out from the frames themselves.
        </p>
        <p>
          This lesson shows how a switch does that: you watch SW1 learn from each frame&apos;s <strong>source</strong>, decide by its <strong>destination</strong>, flood when it doesn&apos;t know, and forget what it hasn&apos;t heard about. Then a user moves desks, SW1&apos;s table becomes wrong without a single error, and you find out why, fix it, and prove it.
        </p>
        <ChecklistCard
          tone="ethernet"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "read the two MAC addresses of a frame and say which one the switch learns from",
            "predict, for any frame, whether SW1 floods it or sends it out one port",
            "explain why a broadcast floods even when SW1 knows every host",
            "explain why SW1 forgets a quiet host, and why a link event never teaches it where a host went",
            "find and repair the stale entry of the incident, and prove HOST-B is reachable again",
          ]}
        />
      </GuideSection>

      <GuideSection id="eth-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="SW1 with three hosts and a hot desk. Everything shown is one LAN: one broadcast domain.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who is where"
          columns={["Device", "SW1 port", "MAC address"]}
          rows={[
            ["HOST-A", "ge-0/0/1", <Mono key="a">{A}</Mono>],
            ["HOST-B", "ge-0/0/2", <Mono key="b">{B}</Mono>],
            ["HOST-C", "ge-0/0/3", <Mono key="c">{C}</Mono>],
            ["DESK-SW (hot desk)", "ge-0/0/4", "unmanaged, one free port"],
          ]}
        />
        <p>
          The MAC addresses are easy to read on purpose: they only differ in the last digit. DESK-SW is a small unmanaged switch under the hot desk. It learns and floods like SW1, but nobody configures it and you can&apos;t ask it anything.
        </p>
        <p className="text-sm text-pv-text-muted">
          One port, two names: this page uses SW1&apos;s Junos names (<Mono>ge-0/0/1</Mono>–<Mono>ge-0/0/4</Mono>). On a Cisco switch the same ports are <Mono>GigabitEthernet1/0/1</Mono>–<Mono>1/0/4</Mono>, printed <Mono>Gi1/0/1</Mono>–<Mono>Gi1/0/4</Mono>. The Ethernet Lab shows whichever you pick.
        </p>
      </GuideSection>

      <GuideSection id="eth-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Learn from the source", body: "Each frame says who sent it. SW1 writes that source MAC down against the port the frame came in on. That is the only way it ever finds a host.", tone: "success" },
            { title: "Decide by the destination", body: "SW1 looks the destination MAC up in its table. Found: out that one port. Not found, or a broadcast: a copy out every other port.", tone: "cyan" },
            { title: "The table is only as fresh as the last frame", body: `An entry is refreshed each time that host sends, and forgotten after ${FDB_AGING_SEC} s of silence or when its port goes down. Nothing else updates it.`, tone: "warning" },
          ]}
        />
      </GuideSection>

      <GuideSection id="eth-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "The first frame", body: "HOST-A → HOST-B on an empty table: SW1 learns HOST-A and floods the frame, because it doesn't know HOST-B yet.", tone: "warning" },
            { title: "The reply", body: "HOST-B answers. SW1 learns HOST-B and sends the reply out ge-0/0/1 only.", tone: "success" },
            { title: "A broadcast", body: "HOST-C sends to everyone. SW1 floods it although it knows every host, and still learns HOST-C.", tone: "arp" },
            { title: "Silence", body: `HOST-C goes quiet for more than ${FDB_AGING_SEC} s, and SW1 forgets it.`, tone: "violet" },
            { title: "A move", body: "HOST-B moves to the hot desk. SW1 finds it there only when HOST-B sends.", tone: "cyan" },
            { title: "The incident", body: "HOST-B comes back to its own desk, and HOST-A can't reach it. Every light is green. You find out why and fix it.", tone: "danger" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on this network, in the same order.</p>
      </GuideSection>

      <GuideSection id="eth-frame" eyebrow="The frame" title="A frame carries two MAC addresses" tone="ethernet">
        <p>
          Everything on this LAN travels in Ethernet frames. When HOST-A sends to HOST-B, its network card builds a frame that starts with two addresses: the <strong>destination</strong> <Mono>{B}</Mono> (who it is for) and the <strong>source</strong> <Mono>{A}</Mono> (who sent it). Then comes the EtherType (what is inside), the data, and a checksum (FCS) that lets the receiver throw away a damaged frame.
        </p>
        <p>
          Every network card keeps only frames addressed to its own MAC (or to everyone) and silently drops the rest. So a copy of HOST-B&apos;s frame that reaches HOST-C does no harm: HOST-C&apos;s card reads the destination, sees it isn&apos;t its own, and discards it.
        </p>
        <Callout tone="ethernet" title="SW1 never changes the frame" icon="→">
          The switch reads both addresses but rewrites neither. The frame that leaves SW1 is bit for bit the frame that came in. Only a router builds a new frame.
        </Callout>
      </GuideSection>

      <GuideSection id="eth-first" eyebrow="The first frame" title="The first frame: learn the source, flood the unknown" tone="warning">
        <p>SW1 has just started and its table is empty. HOST-A&apos;s frame for HOST-B arrives on ge-0/0/1, and SW1 does two things, always in this order:</p>
        <DiagramFrame caption="The frame arrives on ge-0/0/1 (amber). Copies leave every other port (cyan). The destination MAC never changes.">
          <FirstFrameDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Learn", body: <>The source is <Mono>{A}</Mono> and the frame came in on ge-0/0/1, so SW1 writes <Mono>{A} → ge-0/0/1</Mono>.</>, tone: "success" },
            { title: "Look up", body: <>The destination <Mono>{B}</Mono> is not in the table.</>, tone: "danger" },
            { title: "Flood", body: "SW1 sends a copy out ge-0/0/2, ge-0/0/3 and ge-0/0/4, never back out ge-0/0/1. This is unknown unicast: the frame is still addressed to HOST-B alone.", tone: "warning" },
            { title: "Filter at the hosts", body: "HOST-B's card accepts its copy. HOST-C's card discards its copy. DESK-SW has nobody behind its free port, so its copy goes no further.", tone: "cyan" },
          ]}
        />
      </GuideSection>

      <GuideSection id="eth-reply" eyebrow="The reply" title="The reply goes out one port only" tone="success">
        <p>HOST-B answers. Its frame comes in on ge-0/0/2 with source <Mono>{B}</Mono>, so SW1 learns HOST-B there. The destination, HOST-A, is already in the table: SW1 sends the reply out ge-0/0/1 and nowhere else.</p>
        <DiagramFrame caption="HOST-B's reply teaches SW1 where HOST-B lives. HOST-A is already known, so only ge-0/0/1 is used.">
          <ReplyDiagram />
        </DiagramFrame>
        <p>From now on HOST-A ↔ HOST-B is <strong>known unicast</strong> in both directions: one port in, one port out. HOST-C never sees another frame of their conversation, and each frame refreshes its sender&apos;s entry.</p>
      </GuideSection>

      <GuideSection id="eth-broadcast" eyebrow="Broadcast" title="A broadcast floods on purpose" tone="arp">
        <p>
          HOST-C sends a frame to <Mono>{BROADCAST_MAC}</Mono>, the broadcast address, which means &quot;every card on this LAN&quot;. (Here it is an ARP request, EtherType <Mono>0x0806</Mono>; the ARP lesson covers what it asks.) SW1 learns <Mono>{C} → ge-0/0/3</Mono> from the source as usual, and floods the frame out every other port, although it knows exactly where HOST-A and HOST-B are.
        </p>
        <DiagramFrame caption="Both kinds of flood leave every port except the one the frame came in on, for two different reasons.">
          <BroadcastVsUnknownDiagram />
        </DiagramFrame>
        <p>Unknown unicast floods because SW1 is missing an entry, and it stops once the host is learned. A broadcast floods because it is addressed to everyone, and no table entry can ever stop it.</p>
      </GuideSection>

      <GuideSection id="eth-aging" eyebrow="Time" title="A quiet host is forgotten" tone="violet">
        <p>
          Every learned entry has a timer. Each frame a host <em>sends</em> resets its timer. HOST-A and HOST-B keep talking, so their entries stay. HOST-C goes quiet, and after {FDB_AGING_SEC} s without a frame from it (the usual default), SW1 removes its entry.
        </p>
        <p>Nothing is broken: HOST-C is still cabled to ge-0/0/3. The next frame for HOST-C is simply unknown unicast and is flooded, and HOST-C is learned again the moment it answers.</p>
        <Callout tone="violet" title="Why forget at all?" icon="→">
          Hosts move, switch off and get replaced. A table that never forgot would keep sending frames to places hosts left long ago. Aging trades a little flooding for a table that heals itself.
        </Callout>
      </GuideSection>

      <GuideSection id="eth-move" eyebrow="A move" title="HOST-B moves to the hot desk" tone="cyan">
        <p>
          HOST-B&apos;s user unplugs from ge-0/0/2 and plugs into DESK-SW. Two things happen on SW1. First, ge-0/0/2 goes down, and SW1 removes the entries it had learned there: HOST-B is gone from the table. Second, nothing else. A link going up or down never tells a switch where a host went.
        </p>
        <DiagramFrame caption="HOST-B moves to DESK-SW. SW1 finds the new location only from HOST-B's own frame.">
          <MoveDiagram />
        </DiagramFrame>
        <p>
          When HOST-B sends its first frame from the hot desk, it reaches SW1 on ge-0/0/4, and SW1 learns <Mono>{B} → ge-0/0/4</Mono>. Now look at what holds that entry in place: ge-0/0/4 is the link to DESK-SW, and it stays up whoever is plugged into DESK-SW. Keep that in mind: it is the key to the incident.
        </p>
      </GuideSection>

      <GuideSection id="eth-verify" eyebrow="Verification" title="What working looks like on SW1" tone="success">
        <p>Each idea of this lesson has one place on SW1 that proves it. The commands are only the way to ask; what matters is what each answer proves.</p>
        <FieldTable
          title="Read the lesson on the switch"
          columns={["Question", "Cisco IOS", "Junos", "What the answer proves"]}
          rows={[
            ["Is the link up?", <Mono key="1">show interfaces status</Mono>, <Mono key="2">show interfaces terse</Mono>, "No link, no frames: nothing is learned or delivered on that port"],
            ["Where does SW1 think a MAC is?", <Mono key="3">show mac address-table</Mono>, <Mono key="4">show ethernet-switching table</Mono>, "The port SW1 will use. Compare it with where the host really is"],
            ["Learned, or configured?", <Mono key="5">show mac address-table static</Mono>, <Mono key="6">show configuration vlans</Mono>, "A static entry never ages and is never relearned"],
            ["Is a MAC moving between ports?", <Mono key="7">show logging</Mono>, <Mono key="8">show ethernet-switching mac-learning-log</Mono>, "One move: the host moved. Back and forth: two cards share a MAC"],
          ]}
        />
        <p>After the conversation and the broadcast above, every host is learned on its own port:</p>
        <CliPanel run={{ ...tableOk, output: pickLines(tableOk.output, rows) }} caption="SW1 · Cisco IOS · healthy" />
        <p>And traffic confirms it: after that first flood, a capture on ge-0/0/3 shows none of HOST-A ↔ HOST-B&apos;s frames, only broadcasts and HOST-C&apos;s own traffic.</p>
      </GuideSection>

      <GuideSection id="eth-incident" eyebrow="Incident" title="The incident: HOST-B is back, and unreachable" tone="danger">
        <p>HOST-B&apos;s user worked at the hot desk this morning, and is now back at their own desk, on ge-0/0/2. Since then HOST-A can&apos;t reach HOST-B. Every link light is green, and no device reports an error.</p>
        <DiagramFrame caption="The table is confidently wrong: SW1 forwards correctly by its table, and the table is out of date.">
          <StaleDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "What should happen", tone: "success", tag: "normal", points: ["HOST-B's old entry is gone, so HOST-A's frame is flooded", "HOST-B receives it on ge-0/0/2 and answers", "SW1 learns HOST-B on ge-0/0/2"] },
            { title: "What happens", tone: "danger", tag: "incident", points: ["SW1 still has HOST-B on ge-0/0/4", "HOST-A's frame is known unicast: out ge-0/0/4 only", "DESK-SW's port 2 is empty, so the frame dies there"] },
          ]}
        />
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: ["Leaving the hot desk took down DESK-SW's port, not SW1's ge-0/0/4", "So SW1 never flushed the entry, and it has not aged out yet", "HOST-B has not sent since it came back, so nothing corrected it"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["A cable fault: ge-0/0/2 is connected, and so is ge-0/0/4", "A wrong MAC at HOST-A: the frame is correctly addressed to HOST-B", "Flooding: SW1 isn't flooding at all, it is sure it knows"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="eth-investigate" eyebrow="Investigation" title="Follow the frame, not the link lights" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Is every link up?", look: "show interfaces status: all four ports connected. Layer 1 is fine." },
            { question: "Where does SW1 think HOST-B is?", look: "show mac address-table: HOST-B on Gi1/0/4, the hot desk." },
            { question: "Where is HOST-B really?", look: "On ge-0/0/2. The table and reality disagree: that entry is stale." },
          ]}
        />
        <CliPanel run={{ ...statusBad, output: pickLines(statusBad.output, /Port|Gi1\/0\/[24]/) }} caption="SW1 · Cisco IOS · during the incident" />
        <CliPanel run={{ ...tableBad, output: pickLines(tableBad.output, rows) }} caption="SW1 · Cisco IOS · during the incident" />
        <p className="text-sm text-pv-text-muted">On Junos the same entry shows as <Mono>{B.toLowerCase()}</Mono> with flag D on <Mono>ge-0/0/4.0</Mono>. The D matters: a dynamic entry was learned, so it can be cleared and relearned.</p>
        <CliPanel run={{ ...junosBad, output: pickLines(junosBad.output, junosRows) }} caption="SW1 · Junos · during the incident" />
      </GuideSection>

      <GuideSection id="eth-repair" eyebrow="Repair" title="Repair, and prove it with fresh traffic" tone="success">
        <p>The entry is wrong, so remove it, and let HOST-B&apos;s own frame teach SW1 the right port. Clear only that entry: nothing else in the table is wrong.</p>
        <CompareCards
          items={[
            { title: "Cisco IOS · SW1", tone: "cyan", tag: "one entry", points: [`clear mac address-table dynamic address ${ciscoMac(B)}`] },
            { title: "Junos · SW1", tone: "violet", tag: "what ge-0/0/4 learned", points: ["clear ethernet-switching table interface ge-0/0/4"] },
          ]}
        />
        <p>Then send HOST-A → HOST-B again. With no entry, SW1 floods it, HOST-B answers from ge-0/0/2, and SW1 learns the right port:</p>
        <CliPanel run={{ ...tableFixed, output: pickLines(tableFixed.output, rows) }} caption="SW1 · Cisco IOS · after the repair" />
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            "show mac address-table lists HOST-B on Gi1/0/2 (ge-0/0/2), learned again",
            "The next HOST-A → HOST-B frame leaves ge-0/0/2 only, and HOST-B receives it",
            "A capture on ge-0/0/4 shows no HOST-B frames any more",
            "HOST-A and HOST-C kept their entries: nothing else was touched",
          ]}
        />
        <p className="text-sm text-pv-text-muted">Waiting also fixes it, eventually: the entry ages out, or the moment HOST-B sends anything, SW1 moves it to ge-0/0/2. Clearing is how you stop waiting.</p>
      </GuideSection>

      <GuideSection id="eth-other" eyebrow="Troubleshooting" title="Other ways SW1's table goes wrong" tone="warning">
        <p>The stale entry is one way for the table to disagree with reality. The lab&apos;s tickets add four more, each with its own evidence. The Deep Dive walks through all five with real Cisco and Junos output.</p>
        <CompareCards
          items={[
            { title: "No link", tone: "danger", tag: "cable / shut port", points: ["The port is notconnect (or disabled)", "The host's entry was flushed with the link", "Frames for it are flooded and nobody accepts them"] },
            { title: "A static entry", tone: "warning", tag: "configured", points: ["The table says STATIC, with no age", "The host sending from its real port changes nothing", "Only removing the configuration fixes it"] },
            { title: "A duplicate MAC", tone: "danger", tag: "two cards, one address", points: ["The MAC moves between two ports (show logging)", "Frames go to whichever card spoke last", "Fixed by giving one card back its own address"] },
            { title: "A silent host", tone: "cyan", tag: "nothing broken", points: ["No entry: the host hasn't sent in the aging time", "Frames for it are flooded, so others see them", "Ends the moment the host sends anything"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="eth-model" eyebrow="Mental model" title="A switch is an honest note-taker" tone="cyan">
        <p>
          SW1 keeps a notebook of last sightings: &quot;I last saw this MAC on that port&quot;. It writes a note only when a host sends, and crosses one out when it goes stale or its port goes dark. To deliver a frame it reads its notes; with no note, it asks every port. It never checks a note against reality, so a note can be missing (the frame floods), old (the frame goes where the host used to be) or forced (a static note nobody can overwrite). Every Ethernet mystery on one switch is one of those three.
        </p>
      </GuideSection>

      <GuideSection id="eth-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "MAC address", def: "The 48-bit hardware address of a network card, written as six bytes." },
            { term: "MAC table (FDB)", def: "The switch's MAC → port table, built by source learning." },
            { term: "Source learning", def: "Writing a frame's source MAC against the port it came in on." },
            { term: "Unknown unicast", def: "A frame for one host that the switch hasn't learned. It is flooded, still addressed to that one host." },
            { term: "Known unicast", def: "A frame for a learned host, sent out that one port." },
            { term: "Broadcast", def: `Destination ${BROADCAST_MAC}: for every card on the LAN, always flooded.` },
            { term: "Aging", def: `Removing a learned entry after ${FDB_AGING_SEC} s (default) without a frame from that MAC.` },
            { term: "Stale entry", def: "A learned entry that points to a port the host has left." },
          ]}
        />
      </GuideSection>

      <GuideSection id="eth-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard
          tone="cyan"
          title="Ethernet & Switching in this lesson"
          mark="→"
          items={[
            "A frame carries a destination and a source MAC; the switch rewrites neither",
            "SW1 learns from the source and decides by the destination",
            "Unknown unicast floods until the host is learned; a broadcast always floods",
            "Known unicast leaves one port only; hosts drop copies that aren't for them",
            `Entries refresh when the host sends and age out after ${FDB_AGING_SEC} s; a port going down flushes them`,
            "A stale entry is fixed by clearing it and letting the host's next frame be learned",
          ]}
        />
      </GuideSection>

      <GuideSection id="eth-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know what SW1 should be doing with every frame, and how to prove it. The Ethernet Lab gives you the same network, with SW1 as Cisco IOS or Junos:</p>
        <FlowSteps
          steps={[
            { title: "Learn (4 levels)", body: "One frame, inside the switch, broadcast and time, two switches and a moving host: you predict each decision before SW1 makes it.", tone: "violet" },
            { title: "Challenges (7)", body: "Teach SW1 every host, make HOST-C see HOST-B's frame, create a stale entry on purpose, pin HOST-B and see the price.", tone: "warning" },
            { title: "Troubleshoot (5 tickets)", body: "This lesson's incident and the four other faults above, reported as users report them.", tone: "danger" },
          ]}
        />
        <PresentationBridge>Watch SW1 learn, flood and forget with moving frames and a live MAC table in the Ethernet presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (the frame byte by byte, MAC address structure, aging and flushing in detail, real device output for every fault, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}
