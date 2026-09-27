import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, DPill, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DSpokeLegend, DSwitchStar, DTable, type SpokeMode } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BROADCAST_MAC, ETH_MAC, FDB_AGING_SEC } from "@/lib/sim-engine/scenarios/ethernetSwitching";

export const ETH_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "eth-mission", label: "The mission" },
  { id: "eth-topology", label: "The LAN" },
  { id: "eth-first", label: "Learn + flood" },
  { id: "eth-reply", label: "Known unicast" },
  { id: "eth-broadcast", label: "Broadcast vs unknown" },
  { id: "eth-aging", label: "Aging & MAC move" },
  { id: "eth-incident", label: "The incident" },
  { id: "eth-verify", label: "Verification" },
  { id: "eth-model", label: "Mental model" },
  { id: "eth-glossary", label: "Glossary" },
  { id: "eth-recap", label: "Recap" },
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

/** SW1 in the middle; `modes` colours each link for one frame. */
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

function TopologyDiagram() {
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

function FirstFrameDiagram() {
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

function ReplyDiagram() {
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

function BroadcastVsUnknownDiagram() {
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

function MoveDiagram() {
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

function StaleDiagram() {
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

export function EthernetLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="eth-mission" eyebrow="This lesson" title="Watch one switch think" tone="ethernet">
        <p>
          A switch has one job: get each Ethernet frame to the port where its destination lives. It is never told where anyone is. It works it out from the frames themselves, one <strong>source</strong> MAC at a time, and keeps what it learns in its <strong>forwarding database</strong> (FDB, also called the MAC table).
        </p>
        <Callout tone="ethernet" title="The one rule to remember">
          A switch learns from the <strong>source</strong> MAC, against the port the frame came in on. It uses the <strong>destination</strong> MAC only to decide where to send the frame.
        </Callout>
      </GuideSection>

      <GuideSection id="eth-topology" eyebrow="Topology" title="SW1, three hosts and a hot desk" tone="cyan">
        <DiagramFrame caption="Every link is one switch port. Everything shown is one broadcast domain.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>
          The addresses are easy to read on purpose: HOST-A <Mono>{A}</Mono>, HOST-B <Mono>{B}</Mono>, HOST-C <Mono>{C}</Mono>. DESK-SW is a small unmanaged switch on ge-0/0/4. It is a learning bridge too, but nobody configures it.
        </p>
      </GuideSection>

      <GuideSection id="eth-first" eyebrow="First frame" title="Learn the source, then flood the unknown" tone="warning">
        <DiagramFrame caption="The frame arrives on ge-0/0/1 (amber). Copies leave every other port (cyan). The destination MAC never changes.">
          <FirstFrameDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Learn", body: <>The frame came in on ge-0/0/1 with source <Mono>{A}</Mono>, so SW1 records <Mono>{A} → ge-0/0/1</Mono>.</>, tone: "warning" },
            { title: "Look up", body: <>SW1 looks up the destination <Mono>{B}</Mono>. There is no entry.</>, tone: "danger" },
            { title: "Flood (unknown unicast)", body: "SW1 sends copies out ge-0/0/2, ge-0/0/3 and ge-0/0/4, but never back out ge-0/0/1. The frame is still a unicast frame for HOST-B. Nothing turns it into a broadcast.", tone: "cyan" },
            { title: "Filter at the hosts", body: "HOST-B's NIC sees its own MAC and accepts the frame. HOST-C's NIC sees a different MAC and discards it.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="eth-reply" eyebrow="The reply" title="Known unicast uses one port" tone="success">
        <DiagramFrame caption="HOST-B's reply teaches SW1 where HOST-B lives. HOST-A is already known, so only ge-0/0/1 is used.">
          <ReplyDiagram />
        </DiagramFrame>
        <p>From now on, frames in both directions are known unicast. When HOST-A sends to HOST-B again, SW1 simply refreshes HOST-A&apos;s entry and forwards out ge-0/0/2. Nothing is flooded.</p>
      </GuideSection>

      <GuideSection id="eth-broadcast" eyebrow="Two kinds of flood" title="Broadcast is not unknown unicast" tone="arp">
        <DiagramFrame caption="Both are flooded out every port except the ingress port, but for different reasons.">
          <BroadcastVsUnknownDiagram />
        </DiagramFrame>
        <p>
          HOST-C&apos;s broadcast (EtherType <Mono>0x0806</Mono>, an ARP request; what ARP does is covered in its own lesson) is flooded even though SW1 knows every host. SW1 still learns <Mono>{C} → ge-0/0/3</Mono> from its source.
        </p>
      </GuideSection>

      <GuideSection id="eth-aging" eyebrow="Time and movement" title="Entries age out, and hosts move" tone="violet">
        <p>
          Every dynamic entry has a timer. Each frame a MAC <em>sources</em> refreshes its entry. An entry that goes {FDB_AGING_SEC} s without a refresh (the IEEE 802.1D recommended default) is removed. That is what happened to HOST-C after it went quiet.
        </p>
        <DiagramFrame caption="HOST-B moves to DESK-SW. SW1 finds the new location only from HOST-B's own frame.">
          <MoveDiagram />
        </DiagramFrame>
        <p>When ge-0/0/2 went down, SW1 flushed the entries learned on that port. That is common managed-switch behaviour, but it tells SW1 nothing about where HOST-B went. The new entry on ge-0/0/4 appears only when HOST-B transmits.</p>
      </GuideSection>

      <GuideSection id="eth-incident" eyebrow="Troubleshooting" title="A stale entry, with no errors anywhere" tone="danger">
        <DiagramFrame caption="The FDB is confidently wrong. SW1 forwards correctly according to its table; the table is out of date.">
          <StaleDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: ["HOST-B moved back to ge-0/0/2 and hasn't sent a frame yet", "ge-0/0/4 (DESK-SW) never went down, so nothing was flushed", "The entry has not aged out yet", "Known unicast goes out ge-0/0/4 only"] },
            { title: "Why the other fixes don't help", tone: "warning", tag: "red herrings", points: ["ARP: HOST-A already uses the right MAC", "A static entry to ge-0/0/4 would lock in the wrong port", "The ge-0/0/4 cable works fine"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="eth-verify" eyebrow="Verification" title="Prove it with frames" tone="success">
        <ChecklistCard
          tone="success"
          title="After clearing the entry"
          mark="✓"
          items={[
            <>HOST-A → HOST-B is unknown unicast again, so SW1 floods it and HOST-B (on ge-0/0/2) receives it.</>,
            <>HOST-B replies. SW1 learns <Mono>{B} → ge-0/0/2</Mono>, the correct port.</>,
            "The next HOST-A → HOST-B frame is known unicast out ge-0/0/2 only.",
          ]}
        />
      </GuideSection>

      <GuideSection id="eth-model" eyebrow="Mental model" title="A switch is a very honest note-taker" tone="cyan">
        <p>SW1 writes down where each sender was last seen. It forwards by those notes, and when it has no note it asks everyone (floods). Its notes are only as fresh as the last frame each host sent. Most switching mysteries come down to a missing note, an old note, or a note in the wrong place.</p>
      </GuideSection>

      <GuideSection id="eth-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "FDB / MAC table", def: "The switch's MAC → port table, built by source learning." },
            { term: "Source learning", def: "Recording a frame's source MAC against its ingress port." },
            { term: "Unknown unicast", def: "A unicast frame whose destination is not in the FDB. It is flooded, and its destination MAC is left unchanged." },
            { term: "Known unicast", def: "A unicast frame whose destination is in the FDB, sent out that one port." },
            { term: "Broadcast", def: `Destination ${BROADCAST_MAC}. Always flooded within the broadcast domain.` },
            { term: "Aging", def: `A dynamic entry is removed after ${FDB_AGING_SEC} s (default) with no frame from that MAC.` },
            { term: "MAC move", def: "The same MAC is learned on a new port, which replaces the old entry." },
            { term: "Ingress exclusion", def: "A frame is never flooded back out the port it arrived on." },
          ]}
        />
      </GuideSection>

      <GuideSection id="eth-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard
          tone="cyan"
          title="Ethernet & Switching"
          mark="→"
          items={["Learn from the source MAC; forward by the destination MAC", "Unknown unicast floods (the destination stays unicast), and hosts filter it", "Known unicast uses one port", "Broadcast always floods", "Entries age out and move only when the host sends", "A stale dynamic entry is fixed by clearing it and letting the host be relearned"]}
        />
      </GuideSection>
    </div>
  );
}
