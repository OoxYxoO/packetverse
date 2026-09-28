import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BROADCAST_MAC, LOOP_WAVES_SHOWN, PRIMARY_PORT, SECONDARY_PORT, SWF_MAC } from "@/lib/sim-engine/scenarios/switchingFundamentals";
import { HostNote, SwNote, TwoSwitches } from "./guideSvg";

export const SWF_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "swl-mission", label: "The mission" },
  { id: "swl-topology", label: "Two switches" },
  { id: "swl-fdbs", label: "Two FDBs" },
  { id: "swl-first", label: "First frame" },
  { id: "swl-reply", label: "The reply" },
  { id: "swl-known", label: "Two lookups" },
  { id: "swl-local", label: "Local & partial" },
  { id: "swl-broadcast", label: "Broadcast" },
  { id: "swl-loop", label: "The loop" },
  { id: "swl-repair", label: "Repair" },
  { id: "swl-verify", label: "Verification" },
  { id: "swl-l2l3", label: "Switching vs routing" },
  { id: "swl-model", label: "Mental model" },
  { id: "swl-glossary", label: "Glossary" },
  { id: "swl-recap", label: "Recap" },
];

const P = PRIMARY_PORT;
const S2 = SECONDARY_PORT;
const FDB_COLS = [
  { label: "MAC", w: 104 },
  { label: "PORT", w: 80 },
  { label: "MEANS", w: 96 },
];

function TopologyDiagram() {
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

function FirstFrameDiagram() {
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

function ReplyDiagram() {
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

function TwoLookupsDiagram() {
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

function BroadcastDiagram() {
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

function LoopDiagram() {
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

function RepairDiagram() {
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

      <GuideSection id="swl-repair" eyebrow="Repair" title="Back to one forwarding path" tone="success">
        <DiagramFrame caption="The copy on the disabled cable is lost; the last copy on the primary link is flooded once and has nowhere to return.">
          <RepairDiagram />
        </DiagramFrame>
        <p>Clearing the FDBs, touching IPv4 TTLs or changing a MAC would not help: none of them removes the second path. Disabling it does.</p>
      </GuideSection>

      <GuideSection id="swl-verify" eyebrow="Verify" title="How you know it's fixed" tone="success">
        <ChecklistCard tone="success" title="After the repair" mark="✓" items={["No copies left circulating between SW1 and SW2", "A new broadcast reaches each host exactly once", "HOST-A's entry is back on SW1 ge-0/0/1 and stays there", "HOST-B → HOST-A is known unicast at SW2 and at SW1"]} />
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
          items={["Each bridge has its own FDB — learning is hop by hop", "A frame can be known at one switch and unknown at the next", "Local traffic stays on its switch", "A broadcast reaches every host across every switch", "Two active paths without loop prevention form a loop that never expires", "Disabling the extra path restores one copy per host and stable entries"]}
        />
      </GuideSection>
    </div>
  );
}
