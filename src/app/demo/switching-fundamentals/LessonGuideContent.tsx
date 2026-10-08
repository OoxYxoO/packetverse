import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, FlowSteps, Glossary, GuideSection, Mono, PathDivider, ProtocolStory, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { BROADCAST_MAC, LOOP_WAVES_SHOWN, PRIMARY_PORT, SECONDARY_PORT, SWF_MAC } from "@/lib/sim-engine/scenarios/switchingFundamentals";
import { HostNote, SwNote, TwoSwitches } from "./guideSvg";

export const SWF_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "swl-mission", label: "The mission" },
  { id: "swl-story", label: "The whole story" },
  { id: "swl-breaks", label: "When it breaks" },
  { id: "swl-topology", label: "Two switches" },
  { id: "swl-fdbs", label: "Two FDBs" },
  { id: "swl-first", label: "First frame" },
  { id: "swl-reply", label: "The reply" },
  { id: "swl-known", label: "Two lookups" },
  { id: "swl-local", label: "Local & partial" },
  { id: "swl-broadcast", label: "Broadcast" },
  { id: "swl-state", label: "Learned state changes" },
  { id: "swl-loop", label: "The loop" },
  { id: "swl-storm", label: "Storm & flapping" },
  { id: "swl-repair", label: "Repair" },
  { id: "swl-verify", label: "Verification" },
  { id: "swl-stp", label: "Why STP exists" },
  { id: "swl-l2l3", label: "Switching vs routing" },
  { id: "swl-model", label: "Mental model" },
  { id: "swl-glossary", label: "Glossary" },
  { id: "swl-recap", label: "Recap" },
  { id: "swl-practice", label: "Practice it" },
];

const P = PRIMARY_PORT;
const S2 = SECONDARY_PORT;
const FDB_COLS = [
  { label: "MAC", w: 104 },
  { label: "PORT", w: 80 },
  { label: "MEANS", w: 96 },
];

export function TopologyDiagram() {
  return (
    <DiagramSvg h={250} label={`SW1 with HOST-A on ge-0/0/1 and HOST-D on ge-0/0/2; SW2 with HOST-B on ge-0/0/1 and HOST-C on ge-0/0/2; primary link ${P} forwarding and secondary link ${S2} disabled`}>
      <TwoSwitches primary="idle" secondary="down" subs={{ SW1: "FDB empty", SW2: "FDB empty" }} />
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`${P} forwards · ${S2} plugged in but disabled · one broadcast domain`}
      </text>
    </DiagramSvg>
  );
}

function IndependentFdbDiagram() {
  return (
    <DiagramSvg h={170} label={`After HOST-B's reply: SW1 FDB has HOST-A on ge-0/0/1 and HOST-B on ${P}; SW2 FDB has HOST-A on ${P} and HOST-B on ge-0/0/1`}>
      <DTable
        x={20}
        y={10}
        title="SW1 FDB — SW1's own view"
        cols={FDB_COLS}
        rows={[
          ["HOST-A", "ge-0/0/1", "local"],
          ["HOST-B", P, "beyond SW2"],
        ]}
        highlight={{ row: 1, color: D.violet }}
      />
      <DTable
        x={340}
        y={10}
        title="SW2 FDB — SW2's own view"
        cols={FDB_COLS}
        rows={[
          ["HOST-A", P, "beyond SW1"],
          ["HOST-B", "ge-0/0/1", "local"],
        ]}
        highlight={{ row: 0, color: D.violet }}
        color={D.violet}
      />
      <text x={320} y={140} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        Same two MACs, two tables, different ports.
      </text>
      <text x={320} y={158} textAnchor="middle" fill={D.muted} fontSize={10}>
        Nothing is copied between the switches — each learned from frames on its own ports.
      </text>
    </DiagramSvg>
  );
}

export function FirstFrameDiagram() {
  return (
    <DiagramSvg h={250} label="HOST-A's first frame to HOST-B: SW1 learns HOST-A, misses HOST-B and floods to HOST-D and SW2; SW2 learns HOST-A on the inter-switch port, misses HOST-B and floods to HOST-B and HOST-C; HOST-D and HOST-C discard">
      <TwoSwitches hosts={{ A: "in", D: "out", B: "out", C: "out" }} primary="right" secondary="down" subs={{ SW1: "MISS", SW2: "MISS" }}>
        <SwNote sw="SW1" dy={-44} text="learn A → ge-0/0/1" color={D.warning} />
        <SwNote sw="SW2" dy={-44} text={`learn A → ${P}`} color={D.warning} />
        <HostNote h="D" text="discards" color={D.danger} />
        <HostNote h="C" text="discards" color={D.danger} />
        <HostNote h="B" text="accepts" color={D.success} />
      </TwoSwitches>
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`Every copy keeps destination ${SWF_MAC["HOST-B"]} — unknown unicast, never a broadcast.`}
      </text>
    </DiagramSvg>
  );
}

export function ReplyDiagram() {
  return (
    <DiagramSvg h={250} label={`HOST-B's reply: SW2 learns HOST-B on ge-0/0/1 and forwards to ${P} only; SW1 learns HOST-B on ${P} and forwards to ge-0/0/1 only`}>
      <TwoSwitches hosts={{ B: "in", A: "out" }} primary="left" secondary="down" subs={{ SW1: "HIT A", SW2: "HIT A" }}>
        <SwNote sw="SW2" dy={-44} text="learn B → ge-0/0/1" color={D.warning} />
        <SwNote sw="SW1" dy={-44} text={`learn B → ${P}`} color={D.warning} />
      </TwoSwitches>
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        Known unicast both times: HOST-C and HOST-D see nothing.
      </text>
    </DiagramSvg>
  );
}

export function TwoLookupsDiagram() {
  return (
    <DiagramSvg h={250} label={`Second HOST-A to HOST-B frame: lookup 1 at SW1 hits HOST-B on ${P}; lookup 2 at SW2 hits HOST-B on ge-0/0/1; no flooding`}>
      <TwoSwitches hosts={{ A: "in", B: "out" }} primary="right" secondary="down" subs={{ SW1: "lookup 1", SW2: "lookup 2" }}>
        <SwNote sw="SW1" dy={-44} text={`B → ${P}`} color={D.cyan} />
        <SwNote sw="SW2" dy={-44} text="B → ge-0/0/1" color={D.cyan} />
      </TwoSwitches>
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        No end-to-end MAC decision: each bridge picks one of its own ports.
      </text>
    </DiagramSvg>
  );
}

export function BroadcastDiagram() {
  return (
    <DiagramSvg h={250} label={`HOST-D's broadcast: SW1 floods to HOST-A and SW2; SW2 learns HOST-D on ${P} and floods to HOST-B and HOST-C; each host gets one copy`}>
      <TwoSwitches hosts={{ D: "in", A: "out", B: "out", C: "out" }} primary="right" secondary="down" subs={{ SW1: "flood", SW2: "flood" }}>
        <HostNote h="A" text="1 copy" color={D.success} />
        <HostNote h="B" text="1 copy" color={D.success} />
        <HostNote h="C" text="1 copy" color={D.success} />
      </TwoSwitches>
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`Destination ${BROADCAST_MAC}: every host in the Layer-2 domain, across both switches.`}
      </text>
    </DiagramSvg>
  );
}

export function LoopDiagram() {
  const waves = [
    { t: `Wave 1 · SW1 floods: HOST-D, ${P} and ${S2} → two copies to SW2`, c: D.warning },
    { t: `Wave 2 · SW2 floods each copy: HOST-B ×2, HOST-C ×2, back on the other link`, c: D.warning },
    { t: `Wave 3 · SW1 floods each again: HOST-A gets its own frame ×2, HOST-D ×2`, c: D.danger },
  ];
  return (
    <DiagramSvg h={330} label={`Both ${P} and ${S2} forward with no loop prevention: HOST-A's broadcast is flooded on both links, each copy returns on the other link, and the copies circulate`}>
      <TwoSwitches hosts={{ A: "in", D: "out", B: "out", C: "out" }} primary="both" secondary="both" subs={{ SW1: "A flaps", SW2: "A flaps" }}>
        <HostNote h="B" text="×2" color={D.danger} />
        <HostNote h="C" text="×2" color={D.danger} />
        <HostNote h="D" text="×3" color={D.danger} />
        <HostNote h="A" text="own frame back ×2" color={D.danger} />
      </TwoSwitches>
      {waves.map((w, i) => (
        <text key={w.t} x={24} y={258 + i * 20} fill={w.c} fontSize={10.5} fontWeight={700}>
          {w.t}
        </text>
      ))}
      <text x={24} y={320} fill={D.muted} fontSize={10}>
        {`The lesson stops drawing after wave ${LOOP_WAVES_SHOWN}. The loop itself never stops: Ethernet has no TTL.`}
      </text>
    </DiagramSvg>
  );
}

export function RepairDiagram() {
  return (
    <DiagramSvg h={250} label={`Repair: ${S2} disabled on both switches; HOST-A's broadcast crosses ${P} once and every host receives exactly one copy`}>
      <TwoSwitches hosts={{ A: "in", D: "out", B: "out", C: "out" }} primary="right" secondary="down" subs={{ SW1: "A → ge-0/0/1", SW2: `A → ${P.slice(-2)}` }}>
        <HostNote h="D" text="1 copy" color={D.success} />
        <HostNote h="B" text="1 copy" color={D.success} />
        <HostNote h="C" text="1 copy" color={D.success} />
      </TwoSwitches>
      <text x={320} y={242} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`${S2} disabled: nothing can come back to the switch that flooded it.`}
      </text>
    </DiagramSvg>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Switching Lab" onPractice={openLab}>
      Same network, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

export function SwitchingLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="swl-mission" eyebrow="This lesson" title="Follow a frame through two switches" tone="ethernet">
        <p>
          The Ethernet lesson showed one switch learning, flooding and forwarding. Real LANs chain switches together. Here a frame from HOST-A to HOST-B has to cross <strong>two</strong> learning bridges, and each one makes its own decision with its own table.
        </p>
        <Callout tone="ethernet" title="The one rule to remember">
          There is no network-wide MAC table. Every switch learns only from frames arriving on <strong>its own</strong> ports, and looks up only in <strong>its own</strong> FDB.
        </Callout>
      </GuideSection>
      <GuideSection id="swl-story" eyebrow="How it works" title="From one switch to two — and what a second cable does" tone="cyan">
        <ProtocolStory
          problem={<>One switch runs out of ports, or the hosts are on two floors. SW1 (HOST-A, HOST-D) and SW2 (HOST-B, HOST-C) are joined by an uplink on {P}: still one broadcast domain, but now two switches each make their own forwarding decision — with their own table.</>}
          steps={[
            { actor: "One switch", action: <>Everything you know from the Ethernet lesson still holds inside each switch: learn the SOURCE MAC against the port it came in on, look up the DESTINATION, forward to one port or flood.</>, verify: "Each switch's own table (show mac address-table / show ethernet-switching table) fills only from frames that reach it.", fails: { symptom: "A switch shows no entries at all.", evidence: "No frame has reached it — or its ports are down. Check link state first." }, tone: "ethernet" },
            { actor: "Add SW2", action: <>A second switch joins over the uplink {P}. Nothing is shared between the two: there is no network-wide MAC table, and no switch ever asks the other.</>, changes: "two tables, both empty", verify: "show lldp neighbors on SW1 names SW2 on the uplink; both tables are independent.", fails: { symptom: "Hosts on SW1 can't reach SW2 at all.", evidence: "The uplink is down at one end (show interfaces status: disabled / notconnect)." }, tone: "cyan" },
            { actor: "HOST-A → HOST-C (first frame)", action: <>SW1 learns A on ge-0/0/1, misses C, floods — to HOST-D and up the uplink. SW2 learns A <strong>behind its uplink</strong>, misses C too, floods to HOST-B and HOST-C.</>, changes: `SW1: A → ge-0/0/1 · SW2: A → ${P}`, why: "each switch learns only from frames entering its own ports, so a remote host is learned against the uplink", verify: `SW2's table: HOST-A on ${P}. A capture on ${P} shows the flooded copy crossing.`, fails: { symptom: "SW2 never learns HOST-A.", evidence: "The frame never crossed: uplink down, or SW1 knew C on a wrong port (a stale or static entry)." }, tone: "warning" },
            { actor: "HOST-C answers (cross-switch traffic)", action: <>The reply is known at both switches: SW2 sends it up the uplink only, SW1 sends it out ge-0/0/1 only. Both switches have now learned C — each against its own port.</>, changes: "selective forwarding in both directions", verify: "Only HOST-A receives the reply; both tables hold both MACs.", fails: { symptom: "The reply is flooded or lost.", evidence: "An entry aged out or points at the wrong port. Compare both tables for both MACs." }, tone: "success" },
            { actor: "Local traffic", action: <>HOST-D → HOST-A: SW1 knows A, so the frame leaves ge-0/0/1 and never touches the uplink. SW2 never hears of HOST-D.</>, verify: "The uplink counters don't move; SW2's table has no HOST-D.", fails: { symptom: "Local frames show up on the uplink.", evidence: "SW1 points the destination at its uplink — its table was misled (a loop, a duplicate MAC, a stale entry)." }, tone: "cyan" },
            { actor: "Broadcast", action: <>An ARP request to <Mono>{BROADCAST_MAC}</Mono> is flooded by SW1 (including the uplink) and again by SW2, whatever their tables say.</>, verify: "Every host receives exactly one copy; both switches learn the sender on the way.", fails: { symptom: "Some hosts never see broadcasts — or see them several times.", evidence: "Missing: an uplink is down. Several copies: two paths between the switches (a loop)." }, tone: "violet" },
            { actor: "Unknown unicast across switches", action: <>A frame can be known at one switch and unknown at the next: SW2 floods HOST-B → HOST-D (it never heard from D), SW1 forwards the same frame out one port.</>, verify: "The journey shows SW2: unknown → flood, SW1: known → one port.", fails: { symptom: "Both switches flood everything, always.", evidence: "Tables keep emptying: aging, ports flapping, or someone clearing them." }, tone: "warning" },
            { actor: "Learned state changes", action: <>Entries age out after 300 s without a frame from that MAC, are flushed when their port goes down, and go <strong>stale</strong> when a silent host moves: SW2 still points HOST-D at the uplink after D was re-cabled to SW2.</>, changes: "flooding returns, or frames go the old way", verify: "Compare where each host really is with where each switch thinks it is. An entry corrects itself the moment that host SENDS.", fails: { symptom: "A host that moved is unreachable until it speaks.", evidence: "A switch's entry points at the port the host left. Clear that entry, or make the host send." }, tone: "warning" },
            { actor: "Add a second link", action: <>ge-0/0/24 is enabled on both switches “for redundancy”, with no loop prevention. The links come up — and nothing happens until something is flooded. Known unicast still takes one port.</>, verify: "show lldp neighbors lists SW2 twice; show spanning-tree: no instance.", fails: { symptom: "Two forwarding links between the same two switches.", evidence: "That alone is the fault: a loop waiting for its first broadcast." }, tone: "danger" },
            { actor: "The loop", action: <>A broadcast flooded up both uplinks arrives at SW2 twice; each copy is flooded out the other uplink, back to SW1, which floods it back up… forever.</>, why: "an Ethernet frame has no TTL — a switch forwards it unchanged, so the copy after a thousand laps is identical to the first", verify: "Hosts receive the same broadcast again and again; uplink counters climb with nobody sending.", fails: { symptom: "Everything crawls, port lights flash non-stop.", evidence: "Duplicate broadcasts at the hosts + climbing counters on two uplinks." }, tone: "danger" },
            { actor: "Storm", action: <>Every new broadcast adds more endless copies; with a third path each copy is flooded two ways and the number doubles every hop — a broadcast storm that saturates links and CPUs.</>, verify: "The per-hop link load grows instead of staying constant.", fails: { symptom: "Links at 100 %, switches unreachable.", evidence: "Remove a path immediately; nothing else stops it." }, tone: "danger" },
            { actor: "MAC flapping", action: <>Every copy still carries the sender&apos;s MAC as its source, so each switch keeps re-learning it on whichever uplink the latest copy came in on: SW1 believes HOST-A — plugged into its own ge-0/0/1 — is behind the uplinks.</>, verify: "show logging: %SW_MATM-4-MACFLAP_NOTIF (Cisco) · show ethernet-switching mac-learning-log (Junos).", fails: { symptom: "Unicast to the flapping host goes the wrong way and is filtered or lost.", evidence: "Flapping between two uplinks = a loop. Flapping between an access port and an uplink with no storm = two devices sharing one MAC." }, tone: "danger" },
            { actor: "Remove the loop", action: <>Disable ge-0/0/24 (one end is enough: the link goes down at both). Copies on it are lost, entries learned on it are flushed, the rest drain at the hosts.</>, verify: "Only one uplink forwards; nothing is left circulating.", fails: { symptom: "Copies still circulating after the change.", evidence: "Another path is still forwarding — check every inter-switch link." }, tone: "success" },
            { actor: "Verify", action: <>Prove it with fresh traffic, not with the configuration: a new broadcast reaches every host exactly once, no MAC moves, and a unicast that failed during the loop now works.</>, verify: "Copies per host = 1; flaps = 0; the stale entries were corrected by the first frames.", fails: { symptom: "A unicast still fails after the loop is gone.", evidence: "A table still holds an entry the loop left behind — the next frame from that host corrects it." }, tone: "success" },
            { actor: "Why STP exists", action: <>You wanted two cables so one can fail — but two forwarding paths make a loop nothing in Ethernet can stop. Spanning Tree keeps both cabled, blocks one port, and unblocks it when the active path fails.</>, verify: "That's the next lesson; here you've seen the problem it solves.", tone: "violet" },
          ]}
          outcome={<>Multi-switch forwarding is per-switch learning and lookup, repeated hop by hop with independent tables. Those tables change — they age, get flushed, go stale. A second forwarding path without loop prevention turns floods into an endless, multiplying storm and makes learning flap. Remove the path, then prove it with traffic.</>}
        />
        <PresentationBridge>See both MAC tables fill, the storm and the MAC flapping animated in the Switching presentation.</PresentationBridge>
      </GuideSection>

      <GuideSection id="swl-breaks" eyebrow="When it breaks" title={`When frames go missing across switches: follow them switch by switch`} tone="danger">
        <p className="text-sm text-pv-text-muted">{`Each switch decides alone, using only its own table. To find a Layer 2 problem across several switches, follow the frame and read each switch's table along the way.`}</p>
        <TroubleshootingFlow
          steps={[
            { question: `Which hosts are affected — on the same switch or across the uplink?`, look: `Local failures point at one switch; cross-switch failures at the uplink or the other switch.` },
            { question: `Where is the destination learned on each switch?`, look: `Read every FDB on the path. Each must point towards the destination: the uplink, or the host's own port. A static entry or a stale one (host moved) points elsewhere.` },
            { question: `Is the uplink up and forwarding?`, look: `Check the port state at both ends (one end disabled = the other notconnect).` },
            { question: `Is a MAC flapping, or is traffic exploding?`, look: `That is a loop: two active paths. Disable one, and use STP.` },
            { question: `Did the destination answer?`, look: `If it did, follow the reply the same way, switch by switch.` },
            { question: `How do you prove the fix?`, look: `Send again. The FDBs stay stable, frames take one path, and each broadcast reaches each host once.` },
          ]}
        />
        <Callout tone="cyan" title="The habit to build" icon="✓">
          Walk the story in order and confirm each step with real evidence (a table, a capture, a command). The first step you cannot confirm is where the problem is. The boxes under each story step above say what to look at.
        </Callout>
      </GuideSection>

      <PathDivider title="Reference">Every part of the story in detail. Read the parts you need.</PathDivider>


      <GuideSection id="swl-topology" eyebrow="Topology" title="Two switches, four hosts, two cables between them" tone="cyan">
        <DiagramFrame caption="The primary link forwards. The secondary cable is connected but disabled until the incident.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>
          HOST-A <Mono>{SWF_MAC["HOST-A"]}</Mono> and HOST-D <Mono>{SWF_MAC["HOST-D"]}</Mono> sit on SW1. HOST-B <Mono>{SWF_MAC["HOST-B"]}</Mono> and HOST-C <Mono>{SWF_MAC["HOST-C"]}</Mono> sit on SW2. There are no VLANs here: all four hosts share one Layer-2 broadcast domain.
        </p>
      </GuideSection>

      <GuideSection id="swl-fdbs" eyebrow="Independent tables" title="Two FDBs, two points of view" tone="violet">
        <DiagramFrame caption="After one exchange between HOST-A and HOST-B. A port that leads to the other switch means 'somewhere beyond it'.">
          <IndependentFdbDiagram />
        </DiagramFrame>
        <p>
          SW1 knows HOST-A is on its own port ge-0/0/1. SW2 knows HOST-A only as &quot;out of <Mono>{P}</Mono>&quot;, because that is where HOST-A&apos;s frames enter SW2. Neither switch knows the other switch&apos;s ports.
        </p>
      </GuideSection>

      <GuideSection id="swl-first" eyebrow="First frame" title="Learned twice, flooded twice" tone="warning">
        <DiagramFrame caption="Ingress in amber, egress in cyan, the inter-switch link in violet. Both switches miss HOST-B and flood.">
          <FirstFrameDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "SW1 learns and misses", body: <>SW1 records <Mono>HOST-A → ge-0/0/1</Mono>, then finds no entry for HOST-B.</>, tone: "warning" },
            { title: "SW1 floods", body: <>Copies leave ge-0/0/2 (HOST-D) and <Mono>{P}</Mono>. Never back out ge-0/0/1, never out the disabled <Mono>{S2}</Mono>.</>, tone: "cyan" },
            { title: "SW2 learns and misses", body: <>SW2 records <Mono>HOST-A → {P}</Mono> in its own table. Its own lookup for HOST-B misses too, so SW2 floods to HOST-B and HOST-C.</>, tone: "warning" },
            { title: "Hosts filter", body: "HOST-B accepts (its own MAC). HOST-D and HOST-C discard: the frame was only flooded to them.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="swl-reply" eyebrow="The reply" title="The reply teaches both switches" tone="success">
        <DiagramFrame caption="Each switch learns HOST-B against a different port. HOST-A is already known, so nothing floods.">
          <ReplyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="swl-known" eyebrow="Fully learned" title="One frame, two separate lookups" tone="cyan">
        <DiagramFrame caption="The second HOST-A → HOST-B frame: two hits, two single-port forwards.">
          <TwoLookupsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="swl-local" eyebrow="Local and partial" title="What stays local, and what one switch doesn't know" tone="violet">
        <FlowSteps
          steps={[
            { title: "Local switching", body: "HOST-D ↔ HOST-A traffic stays on SW1: SW1 knows both ports, so the inter-switch link is never used.", tone: "cyan" },
            { title: "A side effect", body: "Because HOST-D's frames never crossed to SW2, SW2 has no entry for HOST-D.", tone: "violet" },
            { title: "Partial knowledge", body: <>HOST-C → HOST-D: SW2&apos;s lookup misses, so it floods (HOST-B discards a copy). At SW1 the same frame is a hit on ge-0/0/2.</>, tone: "warning" },
          ]}
        />
        <Callout tone="violet" title="Unknown here, known there">
          One frame can be unknown unicast at one bridge and known unicast at the next. That is only possible because each bridge decides on its own.
        </Callout>
      </GuideSection>

      <GuideSection id="swl-broadcast" eyebrow="Broadcast" title="A broadcast crosses every switch" tone="arp">
        <DiagramFrame caption="Each switch floods out every forwarding port except the ingress. One copy reaches every host.">
          <BroadcastDiagram />
        </DiagramFrame>
        <p>
          HOST-D&apos;s ARP request is used only as a realistic broadcast; what ARP does is covered in its own lesson. A broadcast is flooded because of what its destination <em>means</em>. Unknown unicast is flooded because a lookup <em>missed</em>, and it stops once the destination is learned.
        </p>
      </GuideSection>

      <GuideSection id="swl-state" eyebrow="State" title="Learned state changes: aging, flushing, stale entries" tone="warning">
        <FlowSteps
          steps={[
            { title: "Aging", body: "A dynamic entry lives 300 s after the last frame FROM that MAC. Then it is removed, and frames to that MAC are flooded again until it sends.", tone: "warning" },
            { title: "Flushing", body: "When a port goes down, the switch forgets everything learned on it. A link coming up teaches nothing.", tone: "cyan" },
            { title: "Stale after a move", body: <>HOST-D is re-cabled from SW1 to SW2 ge-0/0/3. SW1 flushes it (its port went down). SW2 still says HOST-D → <Mono>{P}</Mono> — and sends HOST-B&apos;s frames up the uplink, away from HOST-D.</>, tone: "danger" },
            { title: "Self-correcting", body: "The moment HOST-D sends anything, SW2 moves the entry to ge-0/0/3. Clearing the entry, or waiting for it to age out, also works.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="swl-loop" eyebrow="Incident" title="Two active paths, no loop prevention" tone="danger">
        <DiagramFrame caption={`${S2} enabled while no STP or other loop-prevention mechanism runs. Counts are after wave ${LOOP_WAVES_SHOWN}.`}>
          <LoopDiagram />
        </DiagramFrame>
        <p>
          Each switch treats every arriving copy as a new broadcast, so a copy that enters on one inter-switch port leaves on the other. The source MAC <Mono>{SWF_MAC["HOST-A"]}</Mono> keeps arriving on different ports, so source learning keeps moving HOST-A&apos;s entry. That is MAC flapping, caused by the loop, not by any fault inside the switches.
        </p>
        <Callout tone="danger" title="Ethernet has no TTL">
          IPv4 packets carry a TTL that routers decrement. An Ethernet frame has only destination, source and EtherType. Switches forward it unchanged, so nothing in the frame ever stops a Layer-2 loop. The lesson stops drawing after {LOOP_WAVES_SHOWN} waves purely for clarity.
        </Callout>
      </GuideSection>

      <GuideSection id="swl-storm" eyebrow="Consequences" title="Storm growth and MAC flapping" tone="danger">
        <FlowSteps
          steps={[
            { title: "Two paths", body: "One broadcast becomes two copies that circulate forever. Each new broadcast adds two more; link counters climb with nobody sending.", tone: "warning" },
            { title: "Three paths", body: "A copy arriving on one link is flooded out the two others: the copies double every hop. Links and switch CPUs saturate within milliseconds.", tone: "danger" },
            { title: "Flapping", body: "Each copy re-teaches the sender's MAC on the port it arrived on, so the entry jumps between uplinks. Unicast to that host follows the latest — wrong — entry.", tone: "danger" },
            { title: "Flapping without a loop", body: "Between an access port and an uplink, with broadcasts arriving once: two devices share one MAC (a cloned VM). Different cause, different fix.", tone: "violet" },
          ]}
        />
      </GuideSection>

      <GuideSection id="swl-repair" eyebrow="Repair" title="Back to one forwarding path" tone="success">
        <DiagramFrame caption="The copy on the disabled cable is lost; the last copy on the primary link is flooded once and has nowhere to return.">
          <RepairDiagram />
        </DiagramFrame>
        <p>Clearing the FDBs, touching IPv4 TTLs or changing a MAC would not help: none of them removes the second path. Disabling it does.</p>
      </GuideSection>

      <GuideSection id="swl-verify" eyebrow="Verify" title="How you know it's fixed" tone="success">
        <ChecklistCard tone="success" title="After the repair" mark="✓" items={["No copies left circulating between SW1 and SW2", "A new broadcast reaches each host exactly once", "HOST-A's entry is back on SW1 ge-0/0/1 and stays there", "HOST-B → HOST-A is known unicast at SW2 and at SW1"]} />
      </GuideSection>

      <GuideSection id="swl-stp" eyebrow="What comes next" title="Why Spanning Tree exists" tone="violet">
        <p>Redundant links are good engineering: one cable is a single point of failure. But two <em>forwarding</em> paths are a loop, and Ethernet itself has no way to end one. Spanning Tree lets the switches agree on one loop-free set of forwarding links, keep the others blocked, and unblock one if the active path fails. How it elects and blocks is the next lesson. In this lesson STP is off on purpose — which is why enabling the second cable created a loop, and why the fix was to remove the path by hand.</p>
      </GuideSection>

      <GuideSection id="swl-l2l3" eyebrow="Layer 2 vs Layer 3" title="Switching is not routing" tone="ip">
        <CompareCards
          items={[
            { title: "Switch (this lesson)", tone: "ethernet", tag: "Layer 2", points: ["Decides on the destination MAC", "Works inside one broadcast domain", "Learns from source MACs", "Forwards the frame unchanged", "No TTL — loops never expire"] },
            { title: "Router (Routing Fundamentals)", tone: "ip", tag: "Layer 3", points: ["Decides on the destination IPv4 address", "Forwards between IP networks", "Never learns routes from source MACs", "Builds a new Ethernet frame per hop", "Decrements the IPv4 TTL"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="swl-model" eyebrow="Mental model" title="A chain of independent decisions" tone="violet">
        <p>Picture each switch as a clerk with a private notebook. The clerk writes down which door each sender came through, and sends a letter out the one door noted for its addressee — or out every door if there is no note. Clerks never compare notebooks. Give two clerks two corridors between them, and a letter sent everywhere keeps coming back.</p>
      </GuideSection>

      <GuideSection id="swl-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "FDB", def: "Forwarding database: one switch's MAC → port table." },
            { term: "Unknown unicast", def: "A unicast frame whose destination this switch has no entry for; flooded." },
            { term: "Known unicast", def: "A lookup hit; the frame leaves one port." },
            { term: "Broadcast", def: `Destination ${BROADCAST_MAC}; always flooded to the whole domain.` },
            { term: "Layer-2 loop", def: "Two or more active paths between bridges with nothing blocking one of them." },
            { term: "MAC flapping", def: "One source MAC arriving on changing ports, so its FDB entry keeps moving." },
          ]}
        />
      </GuideSection>

      <GuideSection id="swl-recap" eyebrow="Recap" title="What you saw" tone="success">
        <ChecklistCard
          tone="cyan"
          title="Recap"
          mark="•"
          items={["Each bridge has its own FDB — learning is hop by hop; remote hosts sit behind the uplink", "A frame can be known at one switch and unknown at the next", "Local traffic stays on its switch", "A broadcast reaches every host across every switch", "Entries age, get flushed and go stale when a silent host moves", "Two active paths without loop prevention form a loop that never expires — a third makes it multiply", "Disabling the extra path, then proving it with traffic, restores one copy per host and stable entries", "Spanning Tree automates exactly that: keep the cable, block the path"]}
        />
      </GuideSection>

      <GuideSection id="swl-practice" eyebrow="Practice" title="Do it yourself" tone="cyan">
        <p>The Deep Dive tab teaches every step in detail, with SW1&apos;s and SW2&apos;s Cisco and Junos output. The Switching Lab lets you create every state change yourself — including the loop — and troubleshoot it on both switches&apos; CLIs.</p>
        <LessonLabBridge />
      </GuideSection>
    </div>
  );
}
