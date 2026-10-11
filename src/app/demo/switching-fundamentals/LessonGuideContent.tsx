import { ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { BROADCAST_MAC, LOOP_WAVES_SHOWN, PRIMARY_PORT, SECONDARY_PORT, SWF_MAC } from "@/lib/sim-engine/scenarios/switchingFundamentals";
import { HostNote, SwNote, TwoSwitches } from "./guideSvg";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { createSwitchNet, snApply, snCloneCfg, snTicket, snTicketState, type SnAction, type SnHost, type SnState, type SnSw } from "@/lib/sim-engine/scenarios/switchNet";
import { snSwitchSets, type SnCliApi } from "./switching-lab/snCli";

export const SWF_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "swl-mission", label: "What this lesson teaches" },
  { id: "swl-network", label: "The network of this lesson" },
  { id: "swl-ideas", label: "Three ideas you need" },
  { id: "swl-walk", label: "What you will watch" },
  { id: "swl-fdbs", label: "Two switches, two tables" },
  { id: "swl-first", label: "The first frame crosses both" },
  { id: "swl-reply", label: "The reply: two lookups" },
  { id: "swl-local", label: "Local traffic, partial knowledge" },
  { id: "swl-broadcast", label: "A broadcast reaches everyone once" },
  { id: "swl-redundancy", label: "Why not a second cable?" },
  { id: "swl-verify", label: "What working looks like" },
  { id: "swl-incident", label: "The incident" },
  { id: "swl-investigate", label: "Count the paths" },
  { id: "swl-repair", label: "Repair and prove it" },
  { id: "swl-stp", label: "Why STP exists" },
  { id: "swl-other", label: "Other ways it breaks" },
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

/** The Switching Lab's own SW1/SW2 command sets, run against a lab state. */
function lessonCli(s: SnState, sw: SnSw, vendor: CliVendor, command: string) {
  const api: SnCliApi = { view: s, act: (a) => snApply(s, a), ios: { SW1: { kind: "exec" }, SW2: { kind: "exec" } }, setIos: () => undefined, junosEdit: { SW1: false, SW2: false }, setJunosEdit: () => undefined, cand: s.cfg.sw, setCand: () => undefined };
  return runGuideCli(snSwitchSets(api, sw)[vendor], command);
}
const traffic = (from: SnHost, to: SnHost): SnAction => ({ type: "traffic", sends: [{ from, to, reply: true }] });
/** HOST-A pings HOST-C across both switches; HOST-D talks to HOST-A on SW1. */
const HEALTHY = [traffic("HOST-A", "HOST-C"), traffic("HOST-D", "HOST-A")].reduce(snApply, createSwitchNet());
/** The lab's "loop" ticket: ge-0/0/24 enabled on both switches, then HOST-A's ARP broadcast. */
const BROKEN = snApply(snTicketState("loop", 1), { type: "traffic", sends: snTicket("loop").repro });
const FIXED = (() => {
  const c = snCloneCfg(BROKEN.cfg);
  c.sw.SW1.shut = [S2];
  c.sw.SW2.shut = [S2];
  return [{ type: "cfg", cfg: c, text: `${S2} shut on both switches` } as SnAction, traffic("HOST-A", "HOST-C")].reduce(snApply, BROKEN);
})();
const DELIVERED = BROKEN.last?.results[0]?.delivered ?? 0;

export function SwitchingLessonGuideContent() {
  const sw1Ok = lessonCli(HEALTHY, "SW1", "cisco", "show mac address-table");
  const sw2Ok = lessonCli(HEALTHY, "SW2", "cisco", "show mac address-table");
  const lldpOk = lessonCli(HEALTHY, "SW1", "cisco", "show lldp neighbors");
  const statusBad = lessonCli(BROKEN, "SW1", "cisco", "show interfaces status");
  const lldpBad = lessonCli(BROKEN, "SW1", "cisco", "show lldp neighbors");
  const logBad = lessonCli(BROKEN, "SW1", "cisco", "show logging");
  const tableBad = lessonCli(BROKEN, "SW1", "cisco", "show mac address-table");
  const stpBad = lessonCli(BROKEN, "SW1", "cisco", "show spanning-tree");
  const statusFixed = lessonCli(FIXED, "SW1", "cisco", "show interfaces status");
  const tableFixed = lessonCli(FIXED, "SW1", "cisco", "show mac address-table");
  const rows = /Vlan|----|DYNAMIC|STATIC|Total/;
  return (
    <div className="space-y-12">
      <GuideSection id="swl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="ethernet">
        <p>
          The office has two floors. Floor 1&apos;s switch, SW1, has HOST-A and HOST-D; floor 2&apos;s switch, SW2, has HOST-B and HOST-C. One cable joins the two switches. In the Ethernet lesson you watched one switch learn and forward; here every frame between the floors is decided by <strong>two</strong> switches, each with only its own notes.
        </p>
        <p>
          This lesson shows how switches work together: you watch both learn independently, flood and forward, know only part of the network, and carry a broadcast to every host once. Then someone adds a second cable &quot;for redundancy&quot;, the whole network crawls, and you find out why, fix it, and prove it.
        </p>
        <ChecklistCard
          tone="ethernet"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "say what each switch learns from one frame, and on which port",
            "predict where each switch floods and where it forwards, across both switches",
            "explain why SW2 never learns a host that only talks on SW1",
            "explain why two cables between two switches break everything, and why Ethernet can't stop it alone",
            "find and repair the loop of this lesson from the switches' evidence, and prove it",
          ]}
        />
      </GuideSection>

      <GuideSection id="swl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption={`Two switches, four hosts, one broadcast domain. ${P} joins the floors; ${S2} is a second cable, disabled.`}>
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who is where"
          columns={["Host", "Switch and port", "MAC"]}
          rows={[
            ["HOST-A", "SW1 ge-0/0/1", <Mono key="a">{SWF_MAC["HOST-A"]}</Mono>],
            ["HOST-D", "SW1 ge-0/0/2", <Mono key="d">{SWF_MAC["HOST-D"]}</Mono>],
            ["HOST-B", "SW2 ge-0/0/1", <Mono key="b">{SWF_MAC["HOST-B"]}</Mono>],
            ["HOST-C", "SW2 ge-0/0/2", <Mono key="c">{SWF_MAC["HOST-C"]}</Mono>],
          ]}
        />
        <p className="text-sm text-pv-text-muted">The link between the floors is {P} on both switches (Gi1/0/23 on Cisco). The second cable, {S2}, is plugged in but shut down at both ends. There are no VLANs and no spanning tree: everything here is one LAN.</p>
      </GuideSection>

      <GuideSection id="swl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Each switch learns on its own", body: "SW1 and SW2 never exchange tables. Each writes down the source MAC of every frame against the port it arrived on, including the port to the other switch.", tone: "success" },
            { title: "Each switch decides on its own", body: "A frame between the floors is looked up twice: SW1 decides by its table, then SW2 by its own. One can flood while the other forwards.", tone: "cyan" },
            { title: "Ethernet frames have no TTL", body: "Nothing in a frame counts hops. If there is a loop, a flooded frame circulates until something breaks the loop.", tone: "danger" },
          ]}
        />
      </GuideSection>

      <GuideSection id="swl-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "Two tables", body: "Both switches start empty and learn independently.", tone: "success" },
            { title: "The first frame", body: "HOST-A → HOST-B: both switches learn HOST-A and both flood.", tone: "warning" },
            { title: "The reply", body: "Both learn HOST-B; every frame after that is two lookups, no flooding.", tone: "cyan" },
            { title: "Partial knowledge", body: "HOST-A ↔ HOST-D stays on SW1, so SW2 never hears of HOST-D.", tone: "violet" },
            { title: "A broadcast", body: "Every host on both floors gets exactly one copy.", tone: "arp" },
            { title: "The incident", body: "A second cable is enabled and everything crawls. You find out why and fix it.", tone: "danger" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on this network, in the same order.</p>
      </GuideSection>

      <GuideSection id="swl-fdbs" eyebrow="Two tables" title="Two switches, two tables" tone="ethernet">
        <p>
          Each switch has its own forwarding table (FDB) and fills it the same way you saw in Ethernet: source MAC against ingress port. The difference is what a port means. To SW1, every host on floor 2 sits behind {P}: one port, many MACs. To SW2, every host on floor 1 sits behind its own {P}.
        </p>
        <DiagramFrame caption="Each table is that switch's own view. The same host appears on different ports in each.">
          <IndependentFdbDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="swl-first" eyebrow="The first frame" title="The first frame crosses both switches" tone="warning">
        <p>HOST-A sends to HOST-B on empty tables. SW1 learns HOST-A on ge-0/0/1 and floods (HOST-D and the uplink). The copy reaches SW2 on {P}: SW2 learns HOST-A <em>there</em> and floods too (HOST-B and HOST-C). HOST-B accepts; HOST-C and HOST-D discard.</p>
        <DiagramFrame caption="Two switches, two learning steps, two floods. The frame itself is never changed.">
          <FirstFrameDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="swl-reply" eyebrow="The reply" title="The reply, then two lookups for every frame" tone="success">
        <p>HOST-B&apos;s reply teaches SW2 where HOST-B is (ge-0/0/1) and SW1 where HOST-B is from <em>its</em> point of view ({P}). Both destinations are now known, so every later frame is two lookups and no flooding:</p>
        <DiagramFrame caption="The reply is known unicast at both switches: HOST-A is already in both tables.">
          <ReplyDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Lookup 1 at SW1, lookup 2 at SW2. Each switch decides by its own table.">
          <TwoLookupsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="swl-local" eyebrow="Partial knowledge" title="Local traffic, and what the other switch never learns" tone="violet">
        <p>
          HOST-D and HOST-A talk. Once SW1 knows both, their frames go port to port on SW1 and never touch the uplink. SW2 therefore never sees a frame from HOST-D and has no entry for it. That is normal: each switch only knows the hosts whose frames it has carried. If HOST-C now sends to HOST-D, SW2 floods (unknown) while SW1 forwards (known): one floods, one forwards.
        </p>
      </GuideSection>

      <GuideSection id="swl-broadcast" eyebrow="Broadcast" title="A broadcast reaches every host once" tone="arp">
        <p>HOST-D broadcasts an ARP request. SW1 floods it to HOST-A and the uplink; SW2 learns HOST-D on {P} and floods it to HOST-B and HOST-C. With a single path, each host gets exactly one copy, and the flood ends at the edge:</p>
        <DiagramFrame caption="One path between the switches: one copy for each host.">
          <BroadcastDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="swl-redundancy" eyebrow="Redundancy" title="Why not simply add a second cable?" tone="danger">
        <p>
          One cable between the floors is a single point of failure, and {S2} is already plugged in. It is shut down on purpose. A switch floods a broadcast out of <em>every</em> port except the one it came in on, and nothing in an Ethernet frame counts hops: there is no TTL to make a frame die. With two cables, a flooded frame can leave on one and come back on the other, with nothing to stop it. Keep that in mind: it is the key to the incident.
        </p>
      </GuideSection>

      <GuideSection id="swl-verify" eyebrow="Verification" title="What working looks like on the switches" tone="success">
        <p>Each idea of this lesson has one place on the switches that proves it. The commands are only the way to ask; what matters is what each answer proves.</p>
        <FieldTable
          title="Read the lesson on the switches"
          columns={["Question", "Cisco IOS", "Junos", "What the answer proves"]}
          rows={[
            ["Where does this switch see a MAC?", <Mono key="1">show mac address-table</Mono>, <Mono key="2">show ethernet-switching table</Mono>, "Its own view: a remote host appears on the uplink"],
            ["How many links to the other switch?", <Mono key="3">show lldp neighbors · show interfaces status</Mono>, <Mono key="4">show lldp neighbors · show interfaces terse</Mono>, "Exactly one active path between the floors"],
            ["Is a MAC moving between ports?", <Mono key="5">show logging</Mono>, <Mono key="6">show ethernet-switching mac-learning-log</Mono>, "Flapping between two uplinks means a loop"],
            ["Is a loop-prevention protocol running?", <Mono key="7">show spanning-tree</Mono>, "— (spanning tree is off in this lab)", "Here: none. Only the shut port prevents a loop"],
          ]}
        />
        <p>After HOST-A pings HOST-C, each switch has learned both hosts, from its own side:</p>
        <CliPanel run={{ ...sw1Ok, output: pickLines(sw1Ok.output, rows) }} caption="SW1 · Cisco IOS · healthy" />
        <CliPanel run={{ ...sw2Ok, output: pickLines(sw2Ok.output, rows) }} caption="SW2 · Cisco IOS · healthy" />
        <CliPanel run={{ ...lldpOk, output: pickLines(lldpOk.output, /Device ID|SW2|Total/) }} caption="SW1 · one neighbor, one link" />
      </GuideSection>

      <GuideSection id="swl-incident" eyebrow="Incident" title="The incident: everything crawls since “redundancy” was added" tone="danger">
        <p>The users say: &quot;Someone enabled the second cable between the floors (ge-0/0/24) for redundancy. Since then the whole network crawls, the port lights flash non-stop, and nobody can reach anybody reliably.&quot;</p>
        <DiagramFrame caption="Both links forward and nothing blocks either: every flooded frame comes back on the other link, and keeps going.">
          <LoopDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "What should happen", tone: "success", tag: "normal", points: ["HOST-A's broadcast crosses the floors once", "Every host gets one copy", "Each switch learns HOST-A once, on one port"] },
            { title: "What happens", tone: "danger", tag: "incident", points: [`One broadcast is delivered ${DELIVERED} times`, "Copies keep circling between the switches", "SW1 learns HOST-A on the uplinks, back and forth"] },
          ]}
        />
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: [`${P} and ${S2} both forward: two paths between the same switches`, "Each switch floods the broadcast out of the other link", "Ethernet has no TTL, and there is no spanning tree to block a port"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["A bad cable: both links are up and carrying frames", "A host: every host is affected at once", "A full table: the tables are being rewritten, not filled"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="swl-investigate" eyebrow="Investigation" title="Count the paths between the switches" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Does a MAC move between ports?", look: "show logging: HOST-A flapping between Gi1/0/23 and Gi1/0/24, both uplinks. One host can't be in two places: its frames are arriving on both." },
            { question: "How many links join the switches?", look: "show interfaces status: Gi1/0/23 and Gi1/0/24 both connected. LLDP: SW2 on both." },
            { question: "Is anything blocking one of them?", look: "show spanning-tree: no instance. Nothing stops the loop." },
          ]}
        />
        <CliPanel run={{ ...logBad, output: pickLines(logBad.output, /MACFLAP/).split("\n").slice(0, 3).join("\n") }} caption="SW1 · the flapping" />
        <CliPanel run={{ ...tableBad, output: pickLines(tableBad.output, rows) }} caption="SW1 · HOST-A learned on an uplink" note="HOST-A is plugged into Gi1/0/1, yet SW1 now has it on Gi1/0/24: its own broadcast came back to SW1 from SW2." />
        <CliPanel run={{ ...statusBad, output: pickLines(statusBad.output, /Port|Gi1\/0\/2[34]/) }} caption="SW1 · two uplinks up" />
        <CliPanel run={{ ...lldpBad, output: pickLines(lldpBad.output, /Device ID|SW2|Total/) }} caption="SW1 · two links to the same neighbor" />
        <CliPanel run={stpBad} caption="SW1 · nothing to block a port" />
      </GuideSection>

      <GuideSection id="swl-repair" eyebrow="Repair" title="Repair, and prove it with a fresh test" tone="success">
        <p>Remove the second path: shut {S2} again, on both switches. Clearing the MAC tables alone would not help: the next broadcast would loop again.</p>
        <CompareCards
          items={[
            { title: "Cisco IOS · SW1 and SW2", tone: "cyan", tag: "one interface", points: ["interface GigabitEthernet1/0/24", "shutdown"] },
            { title: "Junos · SW1 and SW2", tone: "violet", tag: "candidate → commit", points: [`set interfaces ${S2} disable`, "commit"] },
          ]}
        />
        <DiagramFrame caption="One path again: HOST-A's broadcast crosses once, and every host gets exactly one copy.">
          <RepairDiagram />
        </DiagramFrame>
        <CliPanel run={{ ...statusFixed, output: pickLines(statusFixed.output, /Port|Gi1\/0\/2[34]/) }} caption="SW1 · after the repair" />
        <CliPanel run={{ ...tableFixed, output: pickLines(tableFixed.output, rows) }} caption="SW1 · after a fresh ping from HOST-A to HOST-C" />
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            `${S2} is disabled on both switches; one LLDP neighbor entry per switch`,
            "HOST-A is learned on Gi1/0/1 again, and stays there",
            "No new MACFLAP messages after the change",
            "A fresh broadcast reaches each host exactly once",
          ]}
        />
      </GuideSection>

      <GuideSection id="swl-stp" eyebrow="Looking ahead" title="Why STP exists" tone="violet">
        <p>
          Shutting a cable by hand works, but then the redundancy is gone: if {P} fails, someone has to enable {S2}. Real networks want both cables plugged in <em>and</em> no loop. That is the job of the Spanning Tree Protocol: the switches discover the redundant paths and block just enough ports to leave one active path, and unblock one automatically when a link fails. STP and RSTP are a lesson of their own in the Enterprise path; the loop you just saw is exactly the problem they solve.
        </p>
      </GuideSection>

      <GuideSection id="swl-other" eyebrow="Troubleshooting" title="Other ways two switches go wrong" tone="warning">
        <p>The loop is one way to break a switched LAN. The lab&apos;s tickets add four more, each with its own evidence. The Deep Dive walks through all five with real output from both switches.</p>
        <CompareCards
          items={[
            { title: "A host moved floors", tone: "warning", tag: "a stale entry", points: ["A silent host moves from SW1 to SW2", "SW2 still points at the uplink for it", "Fixed by clearing that entry, or by the host sending"] },
            { title: "The uplink is down", tone: "danger", tag: "two islands", points: ["Each floor works on its own", "The uplink is disabled or notconnect", "No LLDP neighbor at all"] },
            { title: "An old static entry", tone: "warning", tag: "frames to the wrong host", points: ["SW1 sends HOST-C's frames to HOST-D's port", "The entry is STATIC: learning can't fix it", "Remove it from the configuration"] },
            { title: "Two hosts, one MAC", tone: "danger", tag: "flapping without a loop", points: ["A cloned VM uses HOST-A's MAC on SW2", "Flapping between a host port and the uplink", "Give the clone its own MAC"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="swl-model" eyebrow="Mental model" title="Two receptionists, one hallway" tone="cyan">
        <p>
          Each floor has a receptionist with their own notebook: &quot;HOST-A? Desk 1. Anyone from upstairs? Through the hallway door.&quot; They never share notebooks, so each only knows who has walked past them. When they don&apos;t know, they announce to every door on their floor, including the hallway. Add a second hallway and every announcement goes down one and comes back up the other, again and again, because nobody keeps count, and both receptionists keep rewriting where everyone sits.
        </p>
      </GuideSection>

      <GuideSection id="swl-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "Uplink (inter-switch link)", def: "The cable between two switches. Every remote host is learned behind it." },
            { term: "Independent learning", def: "Each switch builds its own table from the frames it carries; tables are never synchronized." },
            { term: "Partial knowledge", def: "A switch knows only the hosts whose frames crossed it." },
            { term: "Switching loop", def: "Two or more active paths between switches: flooded frames circulate." },
            { term: "Broadcast storm", def: "Copies of broadcasts multiplying in a loop until links and CPUs are saturated." },
            { term: "MAC flapping", def: "One MAC learned on one port, then another, back and forth." },
            { term: "LLDP", def: "Link Layer Discovery Protocol: each switch announces itself to its direct neighbors." },
            { term: "STP", def: "Spanning Tree Protocol: blocks redundant ports so one loop-free path remains." },
          ]}
        />
      </GuideSection>

      <GuideSection id="swl-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard
          tone="cyan"
          title="Switching in this lesson"
          mark="→"
          items={[
            "Each switch learns independently; a remote host appears on the uplink",
            "A frame between floors is two lookups: one may flood while the other forwards",
            "A switch only knows the hosts whose frames it carried",
            "A broadcast reaches every host once, as long as there is one path",
            "Two active paths and no STP: a loop, a storm, and flapping MACs",
            "Remove the extra path to stop it; STP does that automatically",
          ]}
        />
      </GuideSection>

      <GuideSection id="swl-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know what both switches should be doing, and how to prove it. The Switching Lab gives you this network with SW1 and SW2 as Cisco IOS or Junos:</p>
        <FlowSteps
          steps={[
            { title: "Learn (6 levels)", body: "Two switches and two tables, local stays local, broadcasts, learned state changes, a second link, storm and recovery.", tone: "violet" },
            { title: "Experiment", body: "Send frames between any hosts, move hosts, change ports, and read both tables and both logs.", tone: "warning" },
            { title: "Troubleshoot (5 tickets)", body: "This lesson's incident and the four other faults above, reported as users report them.", tone: "danger" },
          ]}
        />
        <PresentationBridge>Watch two switches learn, flood and forward, and a loop take over, in the Switching presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (learning on two switches, return-path learning, tracing a MAC switch by switch, why a loop never stops, real output for every ticket, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}
