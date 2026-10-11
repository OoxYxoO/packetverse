import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BPDU_DST, BRIDGES, LINK_COST, bidText } from "@/lib/sim-engine/scenarios/stpRstp";
import { Triangle } from "./guideSvg";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { stApply, stTicket, stTicketState, stWarm, type StState, type StSw } from "@/lib/sim-engine/scenarios/stpNet";
import { candOfSw, stSwitchSets, type StCliApi } from "./stp-lab/stCli";

export const STP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "stl-mission", label: "What this lesson teaches" },
  { id: "stl-network", label: "The network of this lesson" },
  { id: "stl-ideas", label: "Three ideas you need" },
  { id: "stl-walk", label: "What you will watch" },
  { id: "stl-loop", label: "Three cables make a loop" },
  { id: "stl-elect", label: "Electing the root" },
  { id: "stl-rootports", label: "Every switch points at SW1" },
  { id: "stl-block", label: "One port waits" },
  { id: "stl-traffic", label: "Traffic on the tree" },
  { id: "stl-fail", label: "When a cable fails" },
  { id: "stl-verify", label: "What a healthy tree looks like" },
  { id: "stl-incident", label: "The incident" },
  { id: "stl-investigate", label: "Count the blocked ports" },
  { id: "stl-repair", label: "Repair and prove it" },
  { id: "stl-other", label: "Other ways the tree breaks" },
  { id: "stl-model", label: "Mental model" },
  { id: "stl-glossary", label: "Glossary" },
  { id: "stl-recap", label: "Recap" },
  { id: "stl-practice", label: "Practice it" },
];

const C = LINK_COST;
const healthyEnds = { L12: ["DP FWD", "RP FWD"] as [string, string], L13: ["DP FWD", "RP FWD"] as [string, string], L23: ["DP FWD", "ALT DISC"] as [string, string] };

export function ClaimsDiagram() {
  return (
    <DiagramSvg h={240} label="Each bridge first advertises itself as root with Root Path Cost 0; BPDUs cross every inter-switch link">
      <Triangle modes={{ L12: "claim", L13: "claim", L23: "claim" }} subs={{ SW1: "root = me", SW2: "root = me", SW3: "root = me" }} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`BPDUs to ${BPDU_DST} — Root ID = own Bridge ID, cost 0 — until something better arrives`}
      </text>
    </DiagramSvg>
  );
}

export function ElectionDiagram() {
  return (
    <DiagramSvg h={170} label="Root election: SW1 priority 24576 beats 32768 on SW2 and SW3; MAC only breaks ties between equal priorities">
      <DTable
        x={60}
        y={8}
        title="Bridge IDs — priority first, MAC only as a tie-break"
        cols={[
          { label: "BRIDGE", w: 80 },
          { label: "PRIORITY", w: 100 },
          { label: "MAC", w: 170 },
          { label: "RESULT", w: 170 },
        ]}
        rows={[
          ["SW1", String(BRIDGES.SW1.priority), BRIDGES.SW1.mac, "lowest → ROOT"],
          ["SW2", String(BRIDGES.SW2.priority), BRIDGES.SW2.mac, "not root"],
          ["SW3", String(BRIDGES.SW3.priority), BRIDGES.SW3.mac, "not root"],
        ]}
        highlight={{ row: 0, color: D.success }}
      />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        24576 &lt; 32768 decides it. SW2 vs SW3 (equal 32768) would fall to the MAC: :02 &lt; :03.
      </text>
    </DiagramSvg>
  );
}

export function RootPortDiagram() {
  return (
    <DiagramSvg h={240} label={`Root Ports: SW2 ge-0/0/1 and SW3 ge-0/0/1 face SW1 directly with Root Path Cost ${C}; the root SW1 has no Root Port`}>
      <Triangle modes={{ L12: "ba", L13: "ba", L23: "idle" }} ends={{ L12: ["DP", "RP"], L13: ["DP", "RP"] }} subs={{ SW1: "ROOT · no RP", SW2: `RP ge-0/0/1 · ${C}`, SW3: `RP ge-0/0/1 · ${C}` }} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`Arrows point toward the root. Direct = ${C}; via the other bridge = ${C * 2}.`}
      </text>
    </DiagramSvg>
  );
}

export function DesignatedDiagram() {
  return (
    <DiagramSvg h={200} label={`SW2-SW3 segment: both advertise Root SW1 cost ${C}; the lower sender Bridge ID (SW2) wins the Designated port; SW3's end becomes Alternate`}>
      <DTable
        x={20}
        y={8}
        title="What each side advertises on the SW2–SW3 segment"
        cols={[
          { label: "SENDER", w: 76 },
          { label: "ROOT ID", w: 150 },
          { label: "COST", w: 70 },
          { label: "BRIDGE ID", w: 190 },
          { label: "PORT", w: 114 },
        ]}
        rows={[
          ["SW2", `SW1 ${BRIDGES.SW1.priority}`, String(C), bidText(BRIDGES.SW2), "Designated"],
          ["SW3", `SW1 ${BRIDGES.SW1.priority}`, String(C), bidText(BRIDGES.SW3), "Alternate"],
        ]}
        highlight={{ row: 0, color: D.success }}
      />
      <text x={20} y={130} fill={D.text} fontSize={10.5} fontWeight={700}>
        Root ID ties · Root Path Cost ties · sender Bridge ID: SW2 (…:02) &lt; SW3 (…:03)
      </text>
      <text x={20} y={150} fill={D.muted} fontSize={10}>
        SW3&apos;s ge-0/0/2 hears better information than it would send and it isn&apos;t SW3&apos;s Root Port:
      </text>
      <text x={20} y={168} fill={D.muted} fontSize={10}>
        it becomes Alternate — a ready backup path to the root, held Discarding.
      </text>
    </DiagramSvg>
  );
}

export function TreeDiagram() {
  return (
    <DiagramSvg h={240} label="Final loop-free tree: SW1 to SW2 and SW1 to SW3 forward; SW2's cross-link port is Designated Forwarding; SW3's is Alternate Discarding; all links physically up">
      <Triangle modes={{ L12: "fwd", L13: "fwd", L23: "alt" }} ends={healthyEnds} subs={{ SW1: "ROOT", SW2: `cost ${C}`, SW3: `cost ${C}` }} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        Three cables up · one port Discarding · no loop in the forwarding topology
      </text>
    </DiagramSvg>
  );
}

export function DataPathDiagram() {
  return (
    <DiagramSvg h={240} label="Customer data from HOST-B to HOST-C goes SW2 to SW1 to SW3, not across the SW2-SW3 cable, while SW3's end is Alternate Discarding">
      <Triangle modes={{ L12: "ba", L13: "ab", L23: "alt" }} ends={{ L23: ["DP FWD", "ALT DISC"] }} hostLinks={{ B: "in", C: "out" }} subs={{ SW1: "transit", SW2: "C → ge-0/0/1", SW3: "C → edge" }} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        HOST-B → SW2 → SW1 → SW3 → HOST-C · BPDUs still use SW2–SW3; customer data does not
      </text>
    </DiagramSvg>
  );
}

export function FailoverDiagram() {
  return (
    <DiagramSvg h={240} label={`SW1-SW3 fails; SW3's former Alternate port becomes Root with cost ${C * 2} and forwards after RSTP reconverges; HOST-B to HOST-C now uses SW2-SW3`}>
      <Triangle modes={{ L12: "fwd", L13: "down", L23: "fwd" }} ends={{ L12: ["DP FWD", "RP FWD"], L13: ["DOWN", "DOWN"], L23: ["DP FWD", "RP FWD"] }} subs={{ SW1: "ROOT", SW2: `cost ${C}`, SW3: `RP ge-0/0/2 · ${C * 2}` }} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`Alternate → Root after RSTP reconvergence · path SW3 → SW2 → SW1 = ${C} + ${C}`}
      </text>
    </DiagramSvg>
  );
}

export function IncidentDiagram() {
  return (
    <DiagramSvg h={240} label="Incident: RSTP participation disabled on SW3's SW2-facing port, which is forced to forward; all three links forward customer data and broadcasts circulate">
      <Triangle modes={{ L12: "loop", L13: "loop", L23: "loop" }} ends={{ L12: ["DP FWD", "RP FWD"], L13: ["DP FWD", "RP FWD"], L23: ["DP FWD", "RSTP OFF"] }} subs={{ SW1: "ROOT", SW2: "A flaps", SW3: "A flaps" }} />
      <text x={320} y={232} textAnchor="middle" fill={D.danger} fontSize={10} fontWeight={700}>
        Unsafe teaching misconfiguration: no port left Discarding → the triangle loops again
      </text>
    </DiagramSvg>
  );
}

export function RepairDiagram() {
  return (
    <DiagramSvg h={240} label="Repair: RSTP participation restored on SW3 ge-0/0/2; it processes SW2's BPDU and returns to Alternate Discarding; each host receives a broadcast once">
      <Triangle modes={{ L12: "fwd", L13: "fwd", L23: "alt" }} ends={healthyEnds} subs={{ SW1: "ROOT", SW2: "1 copy to B", SW3: "1 copy to C" }} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        RSTP back on the port → Alternate/Discarding after reconvergence → loop-free again
      </text>
    </DiagramSvg>
  );
}

export function LoopDiagram() {
  return (
    <DiagramSvg h={240} label="Without spanning tree all three links forward: one broadcast circulates in both directions round the triangle and every host receives endless copies">
      <Triangle modes={{ L12: "loop", L13: "loop", L23: "loop" }} ends={{ L12: ["FWD", "FWD"], L13: ["FWD", "FWD"], L23: ["FWD", "FWD"] }} subs={{ SW1: "copies", SW2: "copies", SW3: "copies" }} />
      <text x={320} y={232} textAnchor="middle" fill={D.danger} fontSize={10} fontWeight={700}>
        Every port forwarding · Ethernet has no TTL · the broadcast never dies
      </text>
    </DiagramSvg>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the STP Lab" onPractice={openLab}>
      Same triangle, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's own command sets, run against lab states: what this page shows is what the STP Lab prints. */
function lessonCli(s: StState, sw: StSw, vendor: CliVendor, command: string) {
  const exec = { kind: "exec" } as const;
  const api: StCliApi = { view: s, act: () => s, ios: { SW1: exec, SW2: exec, SW3: exec }, setIos: () => undefined, junosEdit: { SW1: false, SW2: false, SW3: false }, setJunosEdit: () => undefined, cand: { SW1: candOfSw(s.cfg.sw.SW1), SW2: candOfSw(s.cfg.sw.SW2), SW3: candOfSw(s.cfg.sw.SW3) }, setCand: () => undefined };
  return runGuideCli(stSwitchSets(api, sw)[vendor]!, command);
}
const HEALTHY = stWarm();
const LOOPED = stTicket("loop").repro.reduce((acc, a) => stApply(acc, a), stTicketState("loop", 1));

export function StpLessonGuideContent() {
  const table = /^(Interface|-{5}|Gi1)/;
  const ok = lessonCli(HEALTHY, "SW3", "cisco", "show spanning-tree");
  const bad = lessonCli(LOOPED, "SW3", "cisco", "show spanning-tree");
  return (
    <div className="space-y-12">
      <GuideSection id="stl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="ethernet">
        <p>
          A company cables its three floor switches in a triangle so that any single cable can fail. In the Switching lesson a second active path made the network collapse, and the cure was to unplug it. Here every cable stays plugged in: the switches agree among themselves which ports forward and which one waits as a backup.
        </p>
        <p>
          You will watch <strong>RSTP</strong> elect a root, choose each switch&apos;s path to it, block one port, and fail over when a cable is cut. Then a change window brings the loop back, and you find out why, fix it, and prove the tree is loop-free.
        </p>
        <ChecklistCard
          tone="ethernet"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "say which switch is root in the triangle, and why",
            "name each switch's Root Port and the one blocked port",
            "explain why customer frames avoid the SW2–SW3 cable while BPDUs still cross it",
            "predict the new path when SW1–SW3 fails, and when it comes back",
            "find and repair the port that brought the loop back, and prove the tree is loop-free",
          ]}
        />
      </GuideSection>

      <GuideSection id="stl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="The triangle once RSTP has converged: SW1 is root, SW3's end of SW2–SW3 waits as a backup, every cable is up.">
          <TreeDiagram />
        </DiagramFrame>
        <FieldTable
          title="Three switches, one triangle"
          columns={["Switch", "Bridge priority", "MAC", "Host on ge-0/0/10"]}
          rows={[
            ["SW1 (core)", String(BRIDGES.SW1.priority), BRIDGES.SW1.mac, "HOST-A"],
            ["SW2", String(BRIDGES.SW2.priority), BRIDGES.SW2.mac, "HOST-B"],
            ["SW3", String(BRIDGES.SW3.priority), BRIDGES.SW3.mac, "HOST-C"],
          ]}
        />
        <p>Every switch uses ge-0/0/1 and ge-0/0/2 for the triangle (the lab&apos;s Cisco switches call them Gi1/0/1 and Gi1/0/2); every link is 1 Gb/s with a port cost of {C}. In the STP Lab, SW3 also has a spare port, ge-0/0/11, where a small switch can be plugged in.</p>
      </GuideSection>

      <GuideSection id="stl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "The lowest Bridge ID is root", body: "Priority first, MAC only to break ties. SW1 has 24576, the others 32768, so SW1 is root.", tone: "success" },
            { title: "Everyone keeps one path to the root", body: `Each other switch picks its cheapest port toward SW1, its Root Port: here the direct link, cost ${C}.`, tone: "cyan" },
            { title: "One port per loop waits", body: "On the SW2–SW3 cable, SW2's end wins and forwards; SW3's end is Alternate: up, listening to BPDUs, but not forwarding customer frames.", tone: "warning" },
          ]}
        />
      </GuideSection>

      <GuideSection id="stl-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "Everyone claims to be root", body: "Each switch's first BPDUs name itself, until better information arrives.", tone: "violet" },
            { title: "SW1 wins the election", body: "SW2 and SW3 hear a better Bridge ID and repeat it.", tone: "success" },
            { title: "Root Ports, then Designated and Alternate", body: "SW2 and SW3 choose their direct links to SW1, then settle the cable they share: SW3's end blocks.", tone: "cyan" },
            { title: "Traffic on the tree", body: "HOST-B → HOST-C goes SW2 → SW1 → SW3, and a broadcast reaches each host once.", tone: "ip" },
            { title: "A root link fails", body: "SW1–SW3 is cut. SW3's backup port takes over at once, and returns to Alternate when the cable comes back.", tone: "danger" },
            { title: "The incident", body: "After a change window the triangle loops again. You find the cause and fix it.", tone: "warning" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on this triangle, in the same order.</p>
      </GuideSection>

      <GuideSection id="stl-loop" eyebrow="The problem" title="Three cables make a loop" tone="danger">
        <p>A switch floods a broadcast out of every port except the one it arrived on. If every port forwarded, HOST-A&apos;s ARP request would leave SW1 toward SW2 and SW3, each would flood it to the other, they would send it back to SW1, and so on. Ethernet frames have no TTL, so nothing would ever stop them: a broadcast storm, MAC tables flapping, duplicate replies.</p>
        <DiagramFrame caption="Without spanning tree, one broadcast circulates in both directions round the triangle.">
          <LoopDiagram />
        </DiagramFrame>
        <p>Spanning tree keeps all three cables physically up but allows exactly one active path between any two switches. The switches work out which port waits by exchanging small control messages, <strong>BPDUs</strong>, every 2 seconds.</p>
      </GuideSection>

      <GuideSection id="stl-elect" eyebrow="The election" title="Everyone claims, SW1 wins" tone="violet">
        <p>At first every switch claims to be root itself: &quot;the root is me, at cost 0&quot;. Then they compare Bridge IDs. The lowest wins, and the priority is compared before the MAC. SW1 was given 24576 on purpose, so the core switch is root rather than whichever MAC happens to be lowest.</p>
        <DiagramFrame caption="Each bridge's first BPDUs name itself as root.">
          <ClaimsDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Priority is compared before the MAC.">
          <ElectionDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="stl-rootports" eyebrow="Root Ports" title="Every switch points at SW1" tone="cyan">
        <p>SW2 and SW3 each keep one <strong>Root Port</strong>: their cheapest path to SW1. The cost is added on the port where the BPDU arrives. SW3 hears SW1 directly at 0 + {C}, and through SW2 at {C} + {C}, so its direct port ge-0/0/1 wins. SW1, the root, has no Root Port at all.</p>
        <DiagramFrame caption="Root Ports face the root; the root itself has none.">
          <RootPortDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="stl-block" eyebrow="Blocking" title="One port waits" tone="warning">
        <p>That leaves the SW2–SW3 cable. Both ends offer the root at cost {C}, so the tie goes to the lower Bridge ID: SW2 (…:02) beats SW3 (…:03). SW2&apos;s end is <strong>Designated</strong> and forwards. SW3&apos;s end is neither Root nor Designated: it becomes <strong>Alternate</strong> and discards customer frames, while still hearing SW2&apos;s BPDUs.</p>
        <DiagramFrame caption="What each side advertises on the SW2–SW3 segment, and who wins.">
          <DesignatedDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Discarding is not down" icon="!">
          SW3&apos;s ge-0/0/2 is physically up and keeps receiving BPDUs. Spanning tree only keeps customer frames off it.
        </Callout>
      </GuideSection>

      <GuideSection id="stl-traffic" eyebrow="Traffic" title="Traffic on the tree" tone="ip">
        <p>Customer frames only cross forwarding ports. HOST-C → HOST-A goes SW3 → SW1 directly. HOST-C → HOST-B goes SW3 → SW1 → SW2, never across the SW2–SW3 cable, even though the two switches are directly connected. SW2 does send floods onto that cable, but SW3 drops them on its Alternate port, so a broadcast reaches each host exactly once.</p>
        <DiagramFrame caption="Control plane and data plane use different paths across SW2–SW3.">
          <DataPathDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="stl-fail" eyebrow="Failover" title="When a cable fails" tone="danger">
        <p>Cut SW1–SW3 and SW3 loses its Root Port. With RSTP its Alternate port becomes the Root Port at once: the new path to the root is SW3 → SW2 → SW1, cost {C * 2}. MAC entries learned on non-edge ports are flushed so frames find the new path, and HOST-C → HOST-A keeps working without losing a ping. Plug the cable back in and the direct path wins again: ge-0/0/2 returns to Alternate.</p>
        <DiagramFrame caption="The pre-computed backup becomes the Root Port.">
          <FailoverDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="stl-verify" eyebrow="Verification" title="What a healthy tree looks like on the switches" tone="success">
        <p>Each idea of this lesson has one place on the switches that proves it:</p>
        <FieldTable
          title="Read the lesson on the switch"
          columns={["Question", "Cisco IOS", "Junos", "What the answer proves"]}
          rows={[
            ["Who is the root?", <Mono key="1">show spanning-tree root</Mono>, <Mono key="2">show spanning-tree bridge</Mono>, "Every switch must name SW1"],
            ["Which port leads to the root, which one blocks?", <Mono key="3">show spanning-tree</Mono>, <Mono key="4">show spanning-tree interface</Mono>, "One Root Port per switch, one blocked port in the triangle"],
            ["Is anything looping?", <Mono key="5">show logging</Mono>, <Mono key="6">show log messages</Mono>, "No MAC-flap messages"],
          ]}
        />
        <p>On a healthy SW3 the direct link is the Root Port and the cross-link is Alternate, blocking (<Mono>Altn BLK</Mono>):</p>
        <CliPanel run={{ ...ok, output: pickLines(ok.output, table) }} caption="SW3 · Cisco IOS · healthy" />
        <p>And traffic confirms it: one ARP broadcast reaches each host exactly once, and HOST-C → HOST-B goes through SW1.</p>
      </GuideSection>

      <GuideSection id="stl-incident" eyebrow="Incident" title="The incident: duplicates after a change window" tone="danger">
        <p>After maintenance on SW3, the whole LAN crawls, link lights flash nonstop, and pings return <Mono>DUP!</Mono>. All three cables are up and every switch still names SW1 as root.</p>
        <DiagramFrame caption="No port left Discarding: the triangle loops again.">
          <IncidentDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: ["Spanning tree was disabled on SW3's port toward SW2", "That port no longer sends or processes BPDUs, so nothing tells it to block", "With no Discarding port, the triangle is a loop again"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["A new root: every switch still names SW1", "A bad cable: a cable fault removes a path, it doesn't create a loop", "A host problem: clearing MAC tables or unplugging a host doesn't stop the storm"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="stl-investigate" eyebrow="Investigation" title="Count the blocked ports" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "A loop, a detour, or an outage?", look: "Duplicates and MAC-flap logs: a loop." },
            { question: "Is the root the switch you designed?", look: "show spanning-tree root on every switch: SW1, as designed." },
            { question: "Does exactly one port block in the triangle?", look: "show spanning-tree on SW3: nothing blocks any more." },
            { question: "Which port is outside spanning tree?", look: "SW3 Gi1/0/2: BPDU filter enabled (Junos: rstp interface ge-0/0/2 disable)." },
          ]}
        />
        <CliPanel run={{ ...bad, output: pickLines(bad.output, table) }} caption="SW3 · Cisco IOS · during the incident" />
      </GuideSection>

      <GuideSection id="stl-repair" eyebrow="Repair" title="Repair, and prove the tree is loop-free" tone="success">
        <CompareCards
          items={[
            { title: "Cisco IOS · SW3", tone: "cyan", tag: "back under spanning tree", points: ["interface Gi1/0/2", "no spanning-tree bpdufilter"] },
            { title: "Junos · SW3", tone: "violet", tag: "candidate → commit", points: ["delete protocols rstp interface ge-0/0/2 disable", "commit"] },
          ]}
        />
        <DiagramFrame caption="RSTP back on the port: Alternate/Discarding again, loop-free.">
          <RepairDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            "SW3 Gi1/0/2 is Alternate/Blocking again: one blocked port in the triangle",
            "One fresh ARP broadcast reaches each host exactly once",
            "No new MAC-flap messages in the logs",
            "Every switch still names SW1 as root",
          ]}
        />
      </GuideSection>

      <GuideSection id="stl-other" eyebrow="Troubleshooting" title="Other ways the tree breaks" tone="warning">
        <p>A port outside spanning tree is one way to lose the tree. The lab&apos;s tickets add four more, each with its own evidence. The Deep Dive walks through all five with real Cisco and Junos output.</p>
        <CompareCards
          items={[
            { title: "A stray switch becomes root", tone: "violet", tag: "detour", points: ["The Root ID is a MAC you don't know", "Fixed with BPDU guard or root guard on the port"] },
            { title: "A changed port cost", tone: "warning", tag: "wrong Root Port", points: ["The root is right, a Root Port is not", "The direct link is the blocked one"] },
            { title: "A host port that isn't edge", tone: "ip", tag: "30 s outage", points: ["No network for 30 s after a PC reboots", "The port has lost its Edge type"] },
            { title: "One switch on legacy STP", tone: "danger", tag: "slow failover", points: ["30–50 s outage after a link failure", "The protocol line says ieee, not rstp"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="stl-model" eyebrow="Mental model" title="Everyone points at the root" tone="violet">
        <p>Picture every switch pointing at the root along its cheapest path, like water running downhill to one drain. The links those arrows use form the tree. A cable no arrow uses would make a second route between two points, so one end of it keeps its door closed, but keeps listening through the door. If a pipe breaks, the water finds the next-cheapest way down, through that door. Take a door out of the system altogether and nothing can close it: the water goes round and round.</p>
      </GuideSection>

      <GuideSection id="stl-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="cyan">
        <Glossary
          items={[
            { term: "BPDU", def: "Bridge Protocol Data Unit: the spanning-tree message, sent every 2 s." },
            { term: "Bridge ID", def: "Priority, then MAC. The lowest becomes root." },
            { term: "Root Port", def: "A non-root switch's best port toward the root." },
            { term: "Designated Port", def: "The port that forwards onto a link." },
            { term: "Alternate Port", def: "A backup path to the root; Discarding." },
            { term: "Edge port", def: "A host port: forwards as soon as its link comes up." },
          ]}
        />
      </GuideSection>

      <GuideSection id="stl-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard tone="cyan" title="STP & RSTP in this lesson" mark="→" items={["Three cables in a triangle would loop without spanning tree", "SW1 is root because of its lower priority", `SW2 and SW3 reach SW1 over their direct links, cost ${C}`, "SW3's end of SW2–SW3 is Alternate: up, but not forwarding customer frames", "When SW1–SW3 fails, that backup port takes over at once", "With every cable up, exactly one port must block; none blocking means a port is outside spanning tree"]} />
      </GuideSection>

      <GuideSection id="stl-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know who should be root, which port should block, and how to prove it. The STP Lab gives you the same triangle, as Cisco IOS or Junos:</p>
        <FlowSteps
          steps={[
            { title: "Learn (6 levels)", body: "The same steps as this page, one decision at a time.", tone: "violet" },
            { title: "Challenges", body: "Make SW2 root, move the blocked port, fail a link without losing a ping, keep SW1 root when a small switch arrives.", tone: "warning" },
            { title: "Troubleshoot (5 tickets)", body: "This lesson's incident and the four other faults above, reported as users report them.", tone: "danger" },
          ]}
        />
        <PresentationBridge>See the election, the blocked port, a failover and a rogue root animated in the STP presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (BPDU fields, RSTP proposal/agreement, edge ports, guards, real device output for every fault, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}
