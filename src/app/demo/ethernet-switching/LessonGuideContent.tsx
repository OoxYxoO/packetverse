import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, DPill, FlowSteps, Glossary, GuideSection, Mono, PathDivider, ProtocolStory, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { DSpokeLegend, DSwitchStar, DTable, type SpokeMode } from "@/components/lesson/FundamentalsGuideSvg";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { BROADCAST_MAC, ETH_MAC, FDB_AGING_SEC } from "@/lib/sim-engine/scenarios/ethernetSwitching";

export const ETH_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "eth-mission", label: "The mission" },
  { id: "eth-story", label: "The whole story" },
  { id: "eth-breaks", label: "When it breaks" },
  { id: "eth-topology", label: "The LAN" },
  { id: "eth-first", label: "Learn + flood" },
  { id: "eth-reply", label: "Known unicast" },
  { id: "eth-broadcast", label: "Broadcast vs unknown" },
  { id: "eth-aging", label: "Aging & MAC move" },
  { id: "eth-incident", label: "The incident" },
  { id: "eth-verify", label: "Verification" },
  { id: "eth-evidence", label: "Read it on the switch" },
  { id: "eth-other", label: "Other ways it breaks" },
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

      <GuideSection id="eth-story" eyebrow="How it works" title="One frame's journey, and what the switch does at each step" tone="cyan">
        <ProtocolStory
          problem={
            <>
              Several hosts share one LAN. Each frame is meant for one of them, and only the frame says who: the <strong>destination MAC</strong>. A hub would repeat every frame to everyone. A switch must deliver it to the right port, and it starts out knowing no ports at all.
            </>
          }
          steps={[
            { actor: "HOST-A", action: <>builds an Ethernet frame: destination <Mono>{B}</Mono> (HOST-B), source <Mono>{A}</Mono>, sends it on its cable.</>, changes: "a frame arrives on SW1 ge-0/0/1", verify: `A capture on SW1 ge-0/0/1 shows the frame: destination HOST-B, source HOST-A.`, fails: { symptom: `Nothing reaches SW1.`, evidence: `Link down on ge-0/0/1 (port LED, interface status). That is Layer 1: no table can help until the link is up.` }, tone: "ethernet" },
            { actor: "SW1", action: <>reads the <strong>source</strong> MAC and remembers it against the ingress port.</>, changes: <>FDB: <Mono>{A}</Mono> → ge-0/0/1</>, why: "that's the only reliable evidence of where a MAC lives: a frame just came from it", verify: `The MAC address table (FDB) lists HOST-A on ge-0/0/1.`, fails: { symptom: `HOST-A appears on the wrong port, or keeps jumping between ports.`, evidence: `A MAC that flaps between ports means a loop or a duplicate MAC. One that moved once means the host moved.` }, tone: "success" },
            { actor: "SW1", action: <>looks up the <strong>destination</strong> MAC. No entry, so it floods a copy out every other port (never back out ge-0/0/1), frame unchanged.</>, changes: "copies reach HOST-B, HOST-C and DESK-SW", why: "unknown unicast: dropping it would break the very first conversation", verify: `Copies of the frame leave every other port, and none goes back out ge-0/0/1.`, fails: { symptom: `HOST-B never receives the first frame.`, evidence: `HOST-B unplugged or its port down. Or a stale entry still points HOST-B at an old port: then the switch forwards the frame there instead of flooding it (the lesson incident).` }, tone: "warning" },
            { actor: "HOST-B / HOST-C", action: <>each NIC compares the destination with its own MAC. HOST-B accepts; HOST-C discards silently.</>, why: "hosts filter on the destination MAC, so flooding is safe, just wasteful", verify: `Only HOST-B passes the frame up. HOST-C drops it as not addressed to it.`, fails: { symptom: `HOST-B receives the frame but never answers.`, evidence: `That is a host problem (wrong target MAC, host firewall). The switch has done its job.` }, tone: "cyan" },
            { actor: "HOST-B", action: <>replies to HOST-A.</>, changes: <>FDB: <Mono>{B}</Mono> → ge-0/0/2; the reply leaves on ge-0/0/1 only (HOST-A is known)</>, verify: `The FDB now lists HOST-B on ge-0/0/2, and the reply leaves on ge-0/0/1 only.`, fails: { symptom: `HOST-B is never learned.`, evidence: `A switch learns a MAC only when that MAC sends. No reply means no entry: look at the host.` }, tone: "success" },
            { actor: "SW1", action: <>from now on forwards A ↔ B as <strong>known unicast</strong>: one port each way. A broadcast (<Mono>{BROADCAST_MAC}</Mono>) is still flooded every time, by design.</>, verify: `A ↔ B frames appear only on ports 1 and 2. HOST-C sees none of them.`, fails: { symptom: `Unicast frames are still flooded everywhere.`, evidence: `Entries keep disappearing (aging, port flaps) or moving. Watch the FDB while traffic flows.` }, tone: "violet" },
            { actor: "SW1", action: <>refreshes each entry whenever that MAC sends again; removes it after the aging time (default {FDB_AGING_SEC} s) or when its port goes down.</>, why: "hosts move and switch off, so the table must forget", verify: `Each entry age resets whenever its MAC sends. When a port goes down, its entries vanish.`, fails: { symptom: `After a host moves, its traffic keeps going to the old port for a while.`, evidence: `A stale entry: the old port is still up (for example through a desk switch), so nothing removed it. Clear the entry or let the host send once.` }, tone: "warning" },
          ]}
          outcome={
            <>
              The switch builds its map purely from source MACs and uses it to deliver each frame to one port. When the map is wrong (a <strong>stale entry</strong>, for example a host moved behind a port that never went down), frames are forwarded confidently to the wrong place and no device reports an error. The fix is to clear the entry or make the host send, then verify that the switch relearns the right port.
            </>
          }
        />
        <PresentationBridge>New to switching? The visual presentation shows every step above with moving frames and a live MAC table.</PresentationBridge>
      </GuideSection>

      <GuideSection id="eth-breaks" eyebrow="When it breaks" title={`When a frame does not arrive: reason from the switch's two lookups`} tone="danger">
        <p className="text-sm text-pv-text-muted">{`A switch only does two things with each frame: it learns the source and looks up the destination. Every Layer 2 failure is one of those two going wrong, or a link that is down.`}</p>
        <TroubleshootingFlow
          steps={[
            { question: `Is the link up at both ends?`, look: `No link, no frames. Check port status and LEDs first.` },
            { question: `Did the switch learn the sender, on the right port?`, look: `Look for the source MAC in the FDB. Missing: no frames are arriving. Wrong port or flapping: loop, duplicate MAC or a moved host.` },
            { question: `What does the switch know about the destination?`, look: `No entry: it floods, and every port gets a copy. An entry: it sends on that one port only. If that port is wrong, the frame goes there and nowhere else, without any error.` },
            { question: `Did the destination receive the frame and answer?`, look: `Capture on the destination port. Received but no answer: host problem. Answer sent: follow the reply through the same two lookups.` },
            { question: `How do you prove the fix?`, look: `Send again. The frame appears on the correct port only, and the FDB shows both MACs on the ports where they really are.` },
          ]}
        />
        <Callout tone="cyan" title="The habit to build" icon="✓">
          Walk the story in order and confirm each step with real evidence (a table, a capture, a command). The first step you cannot confirm is where the problem is. The boxes under each story step above say what to look at.
        </Callout>
      </GuideSection>

      <PathDivider title="Reference">Every part of the story in detail. Read the parts you need.</PathDivider>

      <GuideSection id="eth-topology" eyebrow="Topology" title="SW1, three hosts and a hot desk" tone="cyan">
        <DiagramFrame caption="Every link is one switch port. Everything shown is one broadcast domain.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>
          The addresses are easy to read on purpose: HOST-A <Mono>{A}</Mono>, HOST-B <Mono>{B}</Mono>, HOST-C <Mono>{C}</Mono>. DESK-SW is a small unmanaged switch on ge-0/0/4. It is a learning bridge too, but nobody configures it.
        </p>
        <p className="text-sm text-pv-text-muted">
          One port, two names: this guide uses SW1&apos;s Junos names (<Mono>ge-0/0/1</Mono>–<Mono>ge-0/0/4</Mono>). On a Cisco switch the same ports are <Mono>GigabitEthernet1/0/1</Mono>–<Mono>1/0/4</Mono>, printed <Mono>Gi1/0/1</Mono>–<Mono>Gi1/0/4</Mono> in its MAC table. The Ethernet Lab shows whichever you pick, everywhere at once.
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
        <p>When ge-0/0/2 went down, SW1 flushed the entries learned on that port. That is common managed-switch behavior, but it tells SW1 nothing about where HOST-B went. The new entry on ge-0/0/4 appears only when HOST-B transmits.</p>
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

      <GuideSection id="eth-evidence" eyebrow="Evidence" title="Read the story on the switch itself" tone="cyan">
        <p>Each question in the story has one place on SW1 that answers it. The commands are only the way to ask; what matters is what each answer proves.</p>
        <div className="overflow-x-auto rounded-xl border border-pv-border">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-pv-text-faint">
              <tr>
                <th className="px-3 py-2 font-semibold">Question</th>
                <th className="px-3 py-2 font-semibold">Cisco IOS</th>
                <th className="px-3 py-2 font-semibold">Junos</th>
                <th className="px-3 py-2 font-semibold">What the answer proves</th>
              </tr>
            </thead>
            <tbody className="align-top">
              {[
                ["Is the link up?", "show interfaces status", "show interfaces terse", "No link, no frames: nothing can be learned or delivered on that port."],
                ["Where does SW1 think a MAC is?", "show mac address-table address …", "show ethernet-switching table", "The port SW1 will use. Compare it with where the host really is."],
                ["Was it learned or configured?", "show mac address-table static", "show configuration vlans", "A static entry never ages and is never relearned: only removing it fixes it."],
                ["Did frames really cross a port?", "show interfaces Gi1/0/N", "show interfaces ge-0/0/N", "Counters move only when frames pass. A capture shows which ones."],
                ["Is a MAC moving between ports?", "show logging", "show ethernet-switching mac-learning-log", "One move: the host moved. Back and forth: a duplicate MAC or a loop."],
                ["Make SW1 forget one entry", "clear mac address-table dynamic address …", "clear ethernet-switching table", "The next frame to that MAC is flooded until it sends again — proof of relearning."],
              ].map(([q, c, j, w]) => (
                <tr key={q} className="border-t border-pv-border/60">
                  <td className="px-3 py-2 text-pv-text">{q}</td>
                  <td className="px-3 py-2"><Mono>{c}</Mono></td>
                  <td className="px-3 py-2"><Mono>{j}</Mono></td>
                  <td className="px-3 py-2 text-pv-text-muted">{w}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GuideSection>

      <GuideSection id="eth-other" eyebrow="Troubleshooting" title="Other ways the map goes wrong" tone="warning">
        <p>The stale entry is one way for SW1&apos;s table to disagree with reality. The same two lookups explain the others; each leaves different evidence.</p>
        <CompareCards
          items={[
            { title: "No link", tone: "danger", tag: "cable / shut port", points: ["Port status: notconnect or disabled", "Entries on that port were flushed", "Frames to the host: flooded or dropped, never accepted"] },
            { title: "A static entry", tone: "warning", tag: "configured", points: ["The table says STATIC, with no age", "Survives the host sending from its real port", "Fixed only by removing it from the configuration"] },
            { title: "A duplicate MAC", tone: "danger", tag: "two NICs, one address", points: ["The MAC jumps between two ports (show logging: flapping)", "Frames go to whichever card spoke last", "Fixed by giving one card back its own address"] },
            { title: "A silent host", tone: "cyan", tag: "nothing broken", points: ["No entry for the host: it hasn't sent within the aging time", "Every frame to it is flooded: other hosts' captures see them", "Ends the moment the host sends anything"] },
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

      <GuideSection id="eth-practice" eyebrow="Practice" title="Do it yourself" tone="cyan">
        <p>The Deep Dive tab teaches every step in detail, with SW1&apos;s Cisco and Junos output. The Ethernet Lab runs on this same network in four short levels — one frame, inside the switch, broadcast and time, two switches and a moving host — where you predict each forwarding decision on SW1&apos;s ports and watch its reasoning. Then the engineering workspace opens every device in its own window: SW1&apos;s console (Cisco or Junos), its ports, counters and captures, the hosts&apos; cables and network cards. There you take reported tickets (reproduce, explain from evidence, fix, prove with frames) and practice challenges.</p>
        <LessonLabBridge />
      </GuideSection>
    </div>
  );
}
