import { Callout, ChecklistCard, CompareCards, DIAGRAM as D, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { HOST_IP, LACP_DST, LACP_ETHERTYPE, LAG1_KEY, LAG_NAME, SYSTEMS } from "@/lib/sim-engine/scenarios/lacpLinkAggregation";
import { LagPair } from "./guideSvg";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { lcApply, lcClone, lcTicket, lcTicketState, lcWarm, type LcState, type LcSw } from "@/lib/sim-engine/scenarios/lacpNet";
import { lcSwitchSets, type LcCliApi } from "./lacp-lab/lcCli";

export const LACP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lcl-mission", label: "What this lesson teaches" },
  { id: "lcl-network", label: "The network of this lesson" },
  { id: "lcl-ideas", label: "Three ideas you need" },
  { id: "lcl-walk", label: "What you will watch" },
  { id: "lcl-problem", label: "Two cables are not a bundle" },
  { id: "lcl-pdu", label: "A conversation on every member" },
  { id: "lcl-states", label: "From link-up to Distributing" },
  { id: "lcl-logical", label: "One logical link" },
  { id: "lcl-flows", label: "Flows spread over members" },
  { id: "lcl-fail", label: "When a member fails" },
  { id: "lcl-verify", label: "What a healthy bundle looks like" },
  { id: "lcl-incident", label: "The incident" },
  { id: "lcl-investigate", label: "Compare what each member hears" },
  { id: "lcl-repair", label: "Repair and prove it" },
  { id: "lcl-other", label: "Other ways bundles break" },
  { id: "lcl-model", label: "Mental model" },
  { id: "lcl-glossary", label: "Glossary" },
  { id: "lcl-recap", label: "Recap" },
  { id: "lcl-practice", label: "Practice it" },
];

const K1 = LAG1_KEY.SW1;
const K2 = LAG1_KEY.SW2;

export function BeforeDiagram() {
  return (
    <DiagramSvg h={220} label="Before bundling: two independent links between SW1 and SW2 form a Layer-2 loop; spanning tree would have to hold one of them Discarding">
      <LagPair m23="idle" m24="idle" labels={{ m23: "ge-0/0/23 · separate link", m24: "ge-0/0/24 · separate link" }} subs={{ SW1: "2 ports", SW2: "2 ports" }} />
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        As two independent paths they form a loop — spanning tree would block one of them.
      </text>
    </DiagramSvg>
  );
}

export function PduDiagram() {
  return (
    <DiagramSvg h={220} label={`LACPDUs to ${LACP_DST} with EtherType ${LACP_ETHERTYPE} are exchanged separately on each member; they are link-local and never forwarded`}>
      <LagPair m23="both" m24="both" labels={{ m23: "LACPDUs on ge-0/0/23", m24: "LACPDUs on ge-0/0/24" }} subs={{ SW1: "Active", SW2: "Active" }} />
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        {`Destination ${LACP_DST} · EtherType ${LACP_ETHERTYPE} · subtype 0x01 · one conversation per member`}
      </text>
    </DiagramSvg>
  );
}

export function ActorPartnerDiagram() {
  return (
    <DiagramSvg h={170} label={`Actor and Partner as SW1 sees ge-0/0/23: Actor is SW1 itself with key ${K1}; Partner is what SW2 said about itself, key ${K2}`}>
      <DTable
        x={30}
        y={8}
        title="On SW1 ge-0/0/23 — whose fields are these?"
        cols={[
          { label: "", w: 90 },
          { label: "SYSTEM", w: 200 },
          { label: "KEY", w: 60 },
          { label: "PORT", w: 60 },
          { label: "STATE", w: 170 },
        ]}
        rows={[
          ["Actor", `SW1 ${SYSTEMS.SW1.priority} / …:53:11`, String(K1), "23", "0x3D"],
          ["Partner", `SW2 ${SYSTEMS.SW2.priority} / …:53:22`, String(K2), "23", "0x3D"],
        ]}
      />
      <text x={30} y={120} fill={D.text} fontSize={10.5} fontWeight={700}>
        Actor = what SW1 says about itself. Partner = what SW1 has learned from SW2&apos;s LACPDUs.
      </text>
      <text x={30} y={140} fill={D.muted} fontSize={10}>
        On SW2 the same member shows the mirror image: Actor SW2 (key {K2}), Partner SW1 (key {K1}).
      </text>
      <text x={30} y={158} fill={D.muted} fontSize={10}>
        The keys differ between systems — and that is fine.
      </text>
    </DiagramSvg>
  );
}

export function StatesDiagram() {
  return (
    <DiagramSvg h={200} label="Member state bytes during negotiation: 0x45 defaulted, 0x0D synchronized, 0x1D collecting, 0x3D collecting and distributing">
      <DTable
        x={20}
        y={8}
        title="One member, from link-up to carrying traffic"
        cols={[
          { label: "STATE BYTE", w: 100 },
          { label: "FLAGS SET", w: 330 },
          { label: "CUSTOMER DATA?", w: 170 },
        ]}
        rows={[
          ["0x45", "Activity · Aggregation · Defaulted", "no — partner unknown"],
          ["0x0D", "Activity · Aggregation · Synchronization", "no"],
          ["0x1D", "… · Synchronization · Collecting", "receive only"],
          ["0x3D", "… · Synchronization · Collecting · Distributing", "yes — eligible"],
        ]}
        highlight={{ row: 3, color: D.success }}
        rowH={24}
      />
      <text x={20} y={170} fill={D.muted} fontSize={10}>
        Long timeout throughout (Timeout bit 0). Distributing needs the partner to be Collecting first.
      </text>
    </DiagramSvg>
  );
}

export function LogicalDiagram() {
  return (
    <DiagramSvg h={220} label="LAG1: both members distributing; the MAC table, spanning tree and VLAN trunking see one logical port">
      <LagPair m23="dist" m24="dist" labels={{ m23: "ge-0/0/23 DIST", m24: "ge-0/0/24 DIST" }} lag={`${LAG_NAME} — one logical port on each switch`} subs={{ SW1: `key ${K1}`, SW2: `key ${K2}` }} />
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        Above LACP: one port, one path. Below it: two physical members.
      </text>
    </DiagramSvg>
  );
}

export function FlowsDiagram() {
  return (
    <DiagramSvg h={230} label={`Two flows on two members: Flow 1 HOST-A to HOST-B on ge-0/0/23, Flow 2 HOST-A to HOST-C on ge-0/0/24, chosen by the PacketVerse modeled hash`}>
      <LagPair m23="flow" m24="flow" labels={{ m23: "Flow 1 → HOST-B", m24: "Flow 2 → HOST-C" }} lag={LAG_NAME} hosts={{ A: "in", B: "out", C: "out" }} />
      <text x={320} y={206} textAnchor="middle" fill={D.text} fontSize={10}>
        {`PacketVerse modeled hash: (src + dst last octet) mod 2 — F1 (${HOST_IP["HOST-A"].split(".")[3]} + ${HOST_IP["HOST-B"].split(".")[3]}) → 23 · F2 (${HOST_IP["HOST-A"].split(".")[3]} + ${HOST_IP["HOST-C"].split(".")[3]}) → 24`}
      </text>
      <text x={320} y={222} textAnchor="middle" fill={D.muted} fontSize={10}>
        Real platforms use their own hash inputs. Each flow stays on one member.
      </text>
    </DiagramSvg>
  );
}

export function FailDiagram() {
  return (
    <DiagramSvg h={220} label="ge-0/0/23 fails: it stops collecting and distributing; LAG1 stays up on ge-0/0/24 with reduced capacity and both flows now use ge-0/0/24">
      <LagPair m23="down" m24="flow" labels={{ m23: "ge-0/0/23 DOWN", m24: "Flow 1 + Flow 2" }} lag={`${LAG_NAME} up · 1 member`} hosts={{ A: "in", B: "out", C: "out" }} />
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        The surviving member keeps the LAG up: less capacity, no redundancy — not an outage.
      </text>
    </DiagramSvg>
  );
}

export function RestoreDiagram() {
  return (
    <DiagramSvg h={220} label="Restoring ge-0/0/23: link up, LACPDUs, synchronization, collecting, distributing — only then eligible again">
      <LagPair m23="neg" m24="dist" labels={{ m23: "0x45 → 0x0D → 0x1D → 0x3D", m24: "ge-0/0/24 DIST" }} lag={`${LAG_NAME}`} />
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        Link up ≠ in use. The member carries customer data only after it is Distributing again.
      </text>
    </DiagramSvg>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the LACP Lab" onPractice={openLab}>
      Same switches, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's own command sets, run against lab states: what this page shows is what the LACP Lab prints. */
function lessonCli(s: LcState, sw: LcSw, vendor: CliVendor, command: string) {
  const exec = { kind: "exec" } as const;
  const api: LcCliApi = { view: s, act: () => s, ios: { SW1: exec, SW2: exec }, setIos: () => undefined, junosEdit: { SW1: false, SW2: false }, setJunosEdit: () => undefined, cand: { SW1: lcClone(s.cfg.sw.SW1), SW2: lcClone(s.cfg.sw.SW2) }, setCand: () => undefined };
  return runGuideCli(lcSwitchSets(api, sw)[vendor]!, command);
}
const HEALTHY = lcWarm();
const SPLIT = lcTicket("group").repro.reduce((acc, a) => lcApply(acc, a), lcTicketState("group", 1));

export function LacpLessonGuideContent() {
  const sum = lessonCli(HEALTHY, "SW1", "cisco", "show etherchannel summary");
  const nb = lessonCli(SPLIT, "SW1", "cisco", "show lacp neighbor");
  return (
    <div className="space-y-12">
      <GuideSection id="lcl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="ethernet">
        <p>
          SW1 and SW2 are joined by one 1 Gb/s uplink: a bottleneck, and a single point of failure. A second cable alone wouldn&apos;t help, because spanning tree would block it. This lesson shows how the two switches bundle both cables into one logical link, <strong>{LAG_NAME}</strong>, so both carry traffic and either can fail.
        </p>
        <p>
          You will watch <strong>LACP</strong> negotiate each cable, two flows take different members, and a failed member hand its flows to the other. Then, after a clean-up, LAG1 runs on one member only, and you find out why, fix it, and prove both members carry traffic again.
        </p>
        <ChecklistCard
          tone="ethernet"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "explain why the bundle lets both cables forward",
            "read what each switch says about itself (Actor) and the other end (Partner) on a member",
            "follow a member from link-up to Distributing",
            "predict which member each flow uses, and what happens when one fails",
            "find and repair the member that left the bundle, and prove it carries traffic again",
          ]}
        />
      </GuideSection>

      <GuideSection id="lcl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption={`Both members distributing: ${LAG_NAME} is one logical port on each switch.`}>
          <LogicalDiagram />
        </DiagramFrame>
        <FieldTable
          title="Two switches, two members"
          columns={["", "SW1", "SW2"]}
          rows={[
            ["System ID", `${SYSTEMS.SW1.priority} / ${SYSTEMS.SW1.mac}`, `${SYSTEMS.SW2.priority} / ${SYSTEMS.SW2.mac}`],
            ["Members", "ge-0/0/23, ge-0/0/24", "ge-0/0/23, ge-0/0/24"],
            [`${LAG_NAME} key (guided lesson)`, String(K1), String(K2)],
            ["Hosts", `HOST-A ${HOST_IP["HOST-A"]}`, `HOST-B ${HOST_IP["HOST-B"]} · HOST-C ${HOST_IP["HOST-C"]}`],
          ]}
        />
        <p>In the LACP Lab the same bundle is Cisco <Mono>Port-channel1</Mono> (members Gi1/0/23, Gi1/0/24) or Junos <Mono>ae0</Mono>; SW1 also has HOST-D, and a third cable, ge-0/0/22, waits as a spare you can add to the bundle.</p>
      </GuideSection>

      <GuideSection id="lcl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "One logical port", body: `Above LACP, ${LAG_NAME} is a single port: spanning tree sees one link and has nothing to block.`, tone: "ethernet" },
            { title: "Every member is negotiated", body: "Each cable carries its own LACPDUs. A member forwards only when both ends agree it belongs to the same bundle.", tone: "violet" },
            { title: "One flow, one member", body: "A hash puts each flow on one member, so frames stay in order; different flows spread over the members.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="lcl-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "LACP on one member", body: "SW1 and SW2 exchange LACPDUs on ge-0/0/23: Actor and Partner, system IDs and keys.", tone: "violet" },
            { title: "Select the member", body: "The member becomes synchronized, then Collecting, then Distributing.", tone: "ip" },
            { title: "Aggregate", body: `Both members join: ${LAG_NAME} is one logical link.`, tone: "success" },
            { title: "Distribute flows", body: "HOST-A → HOST-B and HOST-A → HOST-C hash to different members.", tone: "cyan" },
            { title: "Fail and recover a member", body: "ge-0/0/23 goes down and its flow moves; when it returns it renegotiates first.", tone: "danger" },
            { title: "The incident", body: "After a clean-up on SW2, LAG1 runs on one member only. You find the cause and fix it.", tone: "warning" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on these two switches, in the same order.</p>
      </GuideSection>

      <GuideSection id="lcl-problem" eyebrow="The problem" title="Two cables are a loop, not a bundle" tone="danger">
        <p>Plug a second cable between SW1 and SW2 and you have two paths between the same switches: a loop, as you saw in the STP lesson. Spanning tree keeps one cable and blocks the other, so the second cable is only a spare. There is <strong>no extra bandwidth</strong>.</p>
        <DiagramFrame caption="Without aggregation, spanning tree has to keep one cable non-forwarding.">
          <BeforeDiagram />
        </DiagramFrame>
        <p>Bundling turns the two cables into one logical link. For that, both switches must agree which cables belong together, and that agreement is LACP&apos;s job.</p>
      </GuideSection>

      <GuideSection id="lcl-pdu" eyebrow="LACP" title="A conversation on every member" tone="violet">
        <p>On each member cable, LACP sends small frames called LACPDUs to the Slow Protocols address <Mono>{LACP_DST}</Mono>. They are link-local and never forwarded. Each one says: &quot;I am system X, this port is in my group with key K, and this is my state&quot; (the <strong>Actor</strong>), plus what it has learned about the other end (the <strong>Partner</strong>).</p>
        <DiagramFrame caption="Slow Protocol frames, one exchange per member.">
          <PduDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Actor = what SW1 says about itself. Partner = what SW1 learned from SW2.">
          <ActorPartnerDiagram />
        </DiagramFrame>
        <p>The key groups one switch&apos;s own ports: SW1 uses {K1}, SW2 uses {K2}, and that is fine. What matters is that every member of the bundle hears the <strong>same</strong> partner system with the <strong>same</strong> partner key. Keep that in mind: it is the key to the incident.</p>
      </GuideSection>

      <GuideSection id="lcl-states" eyebrow="Negotiation" title="From link-up to Distributing" tone="ip">
        <p>A member only carries customer frames when both ends agree it belongs to the same bundle. It moves step by step: the partner is heard and in sync, then <strong>Collecting</strong> (accepting frames), then <strong>Distributing</strong> (sending frames). Each step needs the partner to have reached the step before.</p>
        <DiagramFrame caption="The state byte of one member, from link-up to carrying traffic.">
          <StatesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcl-logical" eyebrow="The bundle" title="One logical link" tone="success">
        <p>With both members Distributing, {LAG_NAME} is up. To everything above LACP it is one port: SW1&apos;s MAC table learns HOST-B behind LAG1, not behind a cable, and spanning tree sees one link (cost 10000: two members sharing the 20000 of one link). There is nothing left to block, so both cables forward.</p>
        <DiagramFrame caption="Above LACP: one port, one path. Below it: two physical members.">
          <LogicalDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcl-flows" eyebrow="Traffic" title="Flows spread over members" tone="cyan">
        <p>The switch hashes each frame&apos;s addresses to pick one member. Every frame of a flow takes the same member, so frames never arrive out of order, and different flows spread over the members. Here HOST-A → HOST-B lands on ge-0/0/23 and HOST-A → HOST-C on ge-0/0/24 (a clearly labeled modeled hash; real platforms hash their own fields).</p>
        <DiagramFrame caption="Per-flow pinning: one flow, one member; many flows spread out.">
          <FlowsDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Not double speed for one flow" icon="!">
          A single transfer stays on one member. Two members double the total capacity across many flows, not the speed of one.
        </Callout>
      </GuideSection>

      <GuideSection id="lcl-fail" eyebrow="Failover" title="When a member fails, and when it comes back" tone="danger">
        <p>Cut ge-0/0/23: its link goes down at both ends, it leaves the bundle at once, and its flow is re-hashed onto ge-0/0/24. LAG1 stays up with less capacity, and spanning tree notices nothing. When the cable comes back, the member renegotiates and only carries traffic once it is Distributing again: link up is not &quot;in use&quot;.</p>
        <DiagramFrame caption="A member fails: its flows move to the surviving member.">
          <FailDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Restoring a member: renegotiate first, distribute second.">
          <RestoreDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcl-verify" eyebrow="Verification" title="What a healthy bundle looks like on the switches" tone="success">
        <p>A bundle is an agreement, and each end shows only its half, so read both switches:</p>
        <FieldTable
          title="Read the lesson on the switch"
          columns={["Question", "Cisco IOS", "Junos", "What the answer proves"]}
          rows={[
            ["Is the bundle up; which members carry traffic?", <Mono key="1">show etherchannel summary</Mono>, <Mono key="2">show lacp interfaces</Mono>, "Every member bundled (P) / Collecting distributing"],
            ["Who is at the other end of each member?", <Mono key="3">show lacp neighbor</Mono>, <Mono key="4">show lacp interfaces</Mono>, "The same partner system and key on every member"],
            ["What does spanning tree see?", <Mono key="5">show spanning-tree</Mono>, <Mono key="6">show spanning-tree interface</Mono>, "One port, Po1 / ae0"],
          ]}
        />
        <p>On a healthy SW1 the Port-channel is in use (<Mono>SU</Mono>) and both members are bundled (<Mono>P</Mono>):</p>
        <CliPanel run={{ ...sum, output: pickLines(sum.output, /^(Group|-{6}|\d )/) }} caption="SW1 · Cisco IOS · healthy" />
        <p>And traffic confirms it: the two flows use both cables, and every ping comes back.</p>
      </GuideSection>

      <GuideSection id="lcl-incident" eyebrow="Incident" title="The incident: LAG1 on one member after a clean-up" tone="danger">
        <p>Someone &quot;cleaned up&quot; SW2&apos;s configuration. Both cables are up and the uplink still works, but at half the bandwidth: LAG1 now runs on ge-0/0/23 only.</p>
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: ["SW2's ge-0/0/24 was put in another group, so its LACPDUs carry another key", "SW1 hears two different partner keys on its two members", "Members with different partners can't share one bundle, so SW1 leaves one out"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["A cable fault: ge-0/0/24 is up, and LACPDUs still arrive on it", "Passive mode or static: the bundle would not be up at all", "The keys differing between SW1 and SW2: that is normal"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="lcl-investigate" eyebrow="Investigation" title="Compare what each member hears" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Everything across the uplink fails, or only bandwidth is missing?", look: "Bandwidth missing: the bundle is up, one member isn't in it." },
            { question: "Is every member bundled at BOTH ends?", look: "show etherchannel summary: ge-0/0/24 is suspended (s) on SW1." },
            { question: "Does every member hear the same partner?", look: "show lacp neighbor on SW1: same partner system, but a different Oper Key on Gi1/0/24." },
          ]}
        />
        <CliPanel run={{ ...nb, output: pickLines(nb.output, /^(Port|Gi1| +LACP)/) }} caption="SW1 · Cisco IOS · during the incident" />
        <p className="text-sm text-pv-text-muted">One different partner key means one member is in the wrong group on the <em>far</em> switch: here SW2.</p>
      </GuideSection>

      <GuideSection id="lcl-repair" eyebrow="Repair" title="Repair, and prove both members carry traffic" tone="success">
        <CompareCards
          items={[
            { title: "Cisco IOS · SW2", tone: "cyan", tag: "back into group 1", points: ["interface Gi1/0/24", "channel-group 1 mode active"] },
            { title: "Junos · SW2", tone: "violet", tag: "candidate → commit", points: ["set interfaces ge-0/0/24 ether-options 802.3ad ae0", "commit"] },
          ]}
        />
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            "Both members (P) at both ends; Junos: Collecting distributing",
            "show lacp neighbor: the same partner key on every member",
            "The two flows use both cables again, and every ping comes back",
            "Spanning tree still sees one port, Po1 / ae0",
          ]}
        />
      </GuideSection>

      <GuideSection id="lcl-other" eyebrow="Troubleshooting" title="Other ways bundles break" tone="warning">
        <p>A member in the wrong group is one way to lose bandwidth. The lab&apos;s tickets add four more. The Deep Dive walks through all five with real Cisco and Junos output.</p>
        <CompareCards
          items={[
            { title: "Static on one end, LACP on the other", tone: "danger", tag: "everything fails", points: ["The LACP end hears no partner and suspends its members", "The static end forwards into ports nobody uses"] },
            { title: "Both ends passive", tone: "warning", tag: "nobody starts", points: ["Po down at both ends", "No partner on any member"] },
            { title: "A silent failure with the slow rate", tone: "ip", tag: "90 s of lost flows", points: ["Link LEDs green, some flows lost", "Fixed with the fast LACP rate"] },
            { title: "No bundle at all", tone: "violet", tag: "one idle cable", points: ["Spanning tree blocks the second uplink", "Both cables must join the channel group"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="lcl-model" eyebrow="Mental model" title="A multi-lane bridge with a marshal at each end" tone="violet">
        <p>Picture the bundle as a road bridge with two lanes. The map (MAC table, spanning tree) shows one bridge. A lane marshal at each end checks, lane by lane, that the other marshal agrees it belongs to this bridge: only then does the lane open. Each car (flow) is waved into one lane and stays in it. Close a lane and traffic squeezes into the other. If the far marshal starts calling one lane by another bridge&apos;s name, that lane stays closed, even though the road surface is perfect.</p>
      </GuideSection>

      <GuideSection id="lcl-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="cyan">
        <Glossary
          items={[
            { term: "LAG", def: "Link aggregation group: several members acting as one logical link (Cisco Port-channel, Junos ae)." },
            { term: "LACPDU", def: "The LACP message, sent on every member." },
            { term: "Actor / Partner", def: "The local end's own information / what it learned about the other end." },
            { term: "Key", def: "A local value grouping one switch's ports that may aggregate together." },
            { term: "Collecting / Distributing", def: "Accepting / sending customer frames on the member." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lcl-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard tone="cyan" title="LACP in this lesson" mark="→" items={[`${LAG_NAME} turns two cables into one logical link`, "Spanning tree sees one port, so both cables forward", "Each member is negotiated on its own, up to Distributing", "Each flow stays on one member; a failed member's flows move", "Every member must hear the same partner system and key; the keys may differ between the switches"]} />
      </GuideSection>

      <GuideSection id="lcl-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know what each member should report and how to prove the bundle works. The LACP Lab gives you the same switches with a spare cable, as Cisco IOS or Junos:</p>
        <FlowSteps
          steps={[
            { title: "Learn (6 levels)", body: "The same steps as this page, one decision at a time.", tone: "violet" },
            { title: "Challenges", body: "Prove both members carry traffic, build a three-member bundle, run one side passive, survive a silent failure within seconds.", tone: "warning" },
            { title: "Troubleshoot (5 tickets)", body: "This lesson's incident and the four other faults above, reported as users report them.", tone: "danger" },
          ]}
        />
        <PresentationBridge>See the bundle form, flows take different members, and a silent failure in the LACP presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (the LACPDU and its flags, modes and rates, hashing, real device output for every fault, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}
