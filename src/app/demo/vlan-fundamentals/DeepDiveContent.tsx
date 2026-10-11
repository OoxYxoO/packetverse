import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CliPair, CliPanel, FailureWalk, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { TPID } from "@/lib/sim-engine/scenarios/vlanFundamentals";
import { vlApply, vlClone, vlTicket, vlTicketState, vlWarm, type VlState, type VlTicketId } from "@/lib/sim-engine/scenarios/vlanNet";
import { vlR1Sets, vlSwitchSets, type VlCliApi } from "./vlan-lab/vlCli";
import { BroadcastDiagram, FdbDiagram, FlatDiagram, IncidentDiagram, JourneyDiagram, NativeDiagram, RouterOnAStickDiagram, TagDiagram, TopologyDiagram } from "./LessonGuideContent";

/**
 * VLANs & TRUNKING DEEP DIVE — the complete study course, taught on the lesson's own network (SW1, SW2, HOST-A…D,
 * R1). Every CLI sample is produced by running the VLAN Lab's model and its real Cisco/Junos command sets.
 * Progression: Foundation → The mechanism → State and behavior → Operations → Troubleshooting → Beyond → Master it.
 */

/** The lab's own command sets, run against lab states: the guide shows exactly what the VLAN Lab prints. */
function cliApi(s: VlState): VlCliApi {
  return { view: s, act: () => s, ios: { SW1: { kind: "exec" }, SW2: { kind: "exec" }, R1: { kind: "exec" } }, setIos: () => undefined, junosEdit: { SW1: false, SW2: false, R1: false }, setJunosEdit: () => undefined, cand: { sw: vlClone(s.cfg.sw), r1: vlClone(s.cfg.r1) }, setCand: () => undefined };
}
const cli = (s: VlState, dev: "SW1" | "SW2" | "R1", vendor: CliVendor, command: string) => runGuideCli(dev === "R1" ? vlR1Sets(cliApi(s))[vendor] : vlSwitchSets(cliApi(s), dev)[vendor], command);
const ticketState = (id: VlTicketId) => vlApply(vlTicketState(id, 1), { type: "traffic", sends: vlTicket(id).repro });
const WARM = vlWarm();

function SizeDiagram() {
  return (
    <DiagramSvg h={170} label="Maximum untagged Ethernet frame 1518 bytes; maximum 802.1Q-tagged frame 1522 bytes because of the 4-byte tag; payload unchanged at 1500">
      <text x={20} y={24} fill={D.muted} fontSize={10} fontWeight={700}>
        untagged · max 1518 B
      </text>
      <DFieldRow x={20} y={32} h={34} fields={[{ label: "14 B header", w: 130 }, { label: "payload ≤ 1500 B", w: 350, color: D.ip }, { label: "FCS 4", w: 60 }]} />
      <text x={20} y={96} fill={D.violet} fontSize={10} fontWeight={700}>
        tagged · max 1522 B
      </text>
      <DFieldRow x={20} y={104} h={34} fields={[{ label: "12 B MACs", w: 110 }, { label: "tag 4", w: 50, color: D.violet, strong: true }, { label: "type 2", w: 40 }, { label: "payload ≤ 1500 B", w: 350, color: D.ip }, { label: "FCS 4", w: 60 }]} />
      <text x={20} y={160} fill={D.muted} fontSize={10}>
        The payload MTU stays 1500. Switches must accept the 4 extra bytes on trunks.
      </text>
    </DiagramSvg>
  );
}

function RulesDiagram() {
  const box = (x: number, y: number, t: string, c: string, w = 170) => <DNode x={x} y={y} label={t} accent={c} w={w} h={34} />;
  return (
    <DiagramSvg h={240} label="802.1Q switch rules: ingress classify by access VLAN or tag VID and drop VIDs not allowed; forward within VLAN; egress filter by membership; tag on trunk, untagged on access">
      <text x={20} y={20} fill={D.cyan} fontSize={10.5} fontWeight={800}>
        INGRESS
      </text>
      {box(110, 50, "Access: VLAN = port VLAN", D.cyan)}
      {box(110, 100, "Trunk: VLAN = tag VID", D.violet)}
      {box(110, 150, "VID not allowed → drop", D.danger)}
      <text x={250} y={20} fill={D.success} fontSize={10.5} fontWeight={800}>
        FORWARD
      </text>
      {box(330, 100, "Learn + look up in VLAN", D.success, 180)}
      <text x={450} y={20} fill={D.warning} fontSize={10.5} fontWeight={800}>
        EGRESS
      </text>
      {box(540, 50, "Member of VLAN?", D.warning, 160)}
      {box(540, 100, "Trunk → add/keep tag", D.violet, 160)}
      {box(540, 150, "Access → untagged", D.cyan, 160)}
      <DArrow x1={197} y1={50} x2={238} y2={92} color={D.muted} width={1.5} />
      <DArrow x1={197} y1={100} x2={238} y2={100} color={D.muted} width={1.5} />
      <DArrow x1={422} y1={100} x2={458} y2={58} color={D.muted} width={1.5} />
      <DArrow x1={540} y1={68} x2={540} y2={82} color={D.muted} width={1.5} />
      <path d="M622,50 H632 V150 H626" fill="none" stroke={D.muted} strokeWidth={1.5} />
      <text x={20} y={192} fill={D.muted} fontSize={10}>
        yes → per egress port: trunk (tag) or access (untagged) · no → not sent
      </text>
      <text x={20} y={210} fill={D.muted} fontSize={10}>
        Adding or removing a tag changes the frame, so the switch recomputes the FCS.
      </text>
    </DiagramSvg>
  );
}

function ChainDiagram() {
  return (
    <DiagramSvg h={170} label="Through several switches, a frame stays tagged across every trunk and is untagged only at the access edges">
      <DNode x={60} y={80} label="Host" sub="untagged" w={90} />
      <DNode x={200} y={80} label="SW-X" accent={D.eth} w={70} />
      <DNode x={340} y={80} label="SW-Y" accent={D.eth} w={70} />
      <DNode x={480} y={80} label="SW-Z" accent={D.eth} w={70} />
      <DNode x={590} y={80} label="Host" sub="untagged" w={80} />
      <DArrow x1={106} y1={80} x2={163} y2={80} color={D.cyan} label="untagged" />
      <DArrow x1={237} y1={80} x2={303} y2={80} color={D.violet} label="VID 10" />
      <DArrow x1={377} y1={80} x2={443} y2={80} color={D.violet} label="VID 10" />
      <DArrow x1={517} y1={80} x2={548} y2={80} color={D.cyan} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        Trunk to trunk: the tag stays. Only access egress removes it.
      </text>
    </DiagramSvg>
  );
}

function L3Diagram() {
  return (
    <DiagramSvg h={210} label="Context: inter-VLAN traffic is routed by a Layer-3 device, such as a router with one interface per VLAN or a Layer-3 switch with IRB interfaces, not switched">
      <DNode x={120} y={60} label="HOST-A" sub="VLAN 10" accent={D.cyan} />
      <DNode x={120} y={150} label="HOST-C" sub="VLAN 20" accent={D.violet} />
      <DNode x={330} y={105} label="L2 switch" accent={D.eth} w={100} />
      <DNode x={530} y={105} label="Router / IRB" sub="one interface per VLAN" accent={D.ip} w={150} />
      <DLink x1={170} y1={65} x2={280} y2={98} color={D.cyan} />
      <DLink x1={170} y1={145} x2={280} y2={112} color={D.violet} />
      <DArrow x1={380} y1={98} x2={455} y2={98} color={D.cyan} label="VLAN 10" />
      <DArrow x1={455} y1={114} x2={380} y2={114} color={D.violet} label="VLAN 20" labelDy={18} />
      <text x={20} y={200} fill={D.muted} fontSize={10}>
        The frame enters the router in VLAN 10 and a NEW frame leaves in VLAN 20. That is routing, not switching.
      </text>
    </DiagramSvg>
  );
}

/** What a healthy network looks like, read from the devices — the state every later section refers to. */
function NormalState() {
  return (
    <div className="space-y-5">
      <p>
        Before anything breaks, learn what &quot;working&quot; looks like. This is the lab&apos;s network after a normal morning: every host has pinged its neighbor and its gateway. Below are the four verification questions, asked on the real devices, with the switch state described above in the answers. Every output is exactly what the VLAN Lab prints. Keep this page in mind: in the five faults below you will compare broken output with it.
      </p>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">1 · Which VLAN is each port in?</h4>
        <CliPair cisco={cli(WARM, "SW1", "cisco", "show vlan brief")} junos={cli(WARM, "SW1", "juniper", "show vlans")} ciscoCaption="SW1 · Cisco IOS" junosCaption="SW1 · Junos" />
        <p className="text-sm text-pv-text-muted">
          Gi1/0/1 (HOST-A) is in VLAN 10, Gi1/0/2 (HOST-C) in VLAN 20; unused ports stay in VLAN 1. The two vendors list different things: Cisco&apos;s <Mono>show vlan brief</Mono> lists <strong>access</strong> ports only, so the trunk Gi1/0/24 is missing from it. Junos <Mono>show vlans</Mono> lists every member, including the trunk ge-0/0/24 in all three VLANs (<Mono>*</Mono> means the port is up).
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">2 · What does each trunk carry?</h4>
        <CliPair cisco={cli(WARM, "SW1", "cisco", "show interfaces trunk")} junos={cli(WARM, "SW2", "juniper", "show ethernet-switching interface")} ciscoCaption="SW1 · Cisco IOS" junosCaption="SW2 · Junos" />
        <p className="text-sm text-pv-text-muted">
          Three facts per trunk: it is trunking, its <strong>native VLAN</strong> is 1, and it <strong>allows</strong> VLANs 1, 10 and 20. Junos shows the same facts per VLAN: SALES and ENG are <Mono>tagged</Mono> on the trunks, default is <Mono>untagged (native)</Mono>. SW2 has a second trunk, ge-0/0/23, toward R1.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">3 · Where was each MAC learned, and in which VLAN?</h4>
        <CliPair cisco={cli(WARM, "SW1", "cisco", "show mac address-table")} junos={cli(WARM, "SW1", "juniper", "show ethernet-switching table")} ciscoCaption="SW1 · Cisco IOS" junosCaption="SW1 · Junos" />
        <p className="text-sm text-pv-text-muted">
          Every entry is a (VLAN, MAC) pair. HOST-A (…53:0a) is local on Gi1/0/1 in VLAN 10; HOST-B (…53:0b) is behind the trunk, also in VLAN 10. R1&apos;s MAC (…53:01) appears <strong>twice</strong>, once in each VLAN: R1 answers in both VLANs through its two subinterfaces, and SW1 keeps a separate entry per VLAN.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">4 · Does each VLAN have a gateway?</h4>
        <CliPair cisco={cli(WARM, "R1", "cisco", "show vlans")} junos={cli(WARM, "R1", "juniper", "show interfaces ge-0/0/0.10")} ciscoCaption="R1 · Cisco IOS" junosCaption="R1 · Junos" />
        <p className="text-sm text-pv-text-muted">
          R1 has one physical port and one subinterface per VLAN. What ties a subinterface to its VLAN is its 802.1Q VLAN ID (Cisco <Mono>encapsulation dot1Q 10</Mono>, Junos <Mono>VLAN-Tag [ 0x8100.10 ]</Mono>), not its number. Each subinterface owns its VLAN&apos;s gateway address: 192.168.10.1 and 192.168.20.1.
        </p>
      </div>
      <Callout tone="success" title="And the traffic proves it" icon="✓">
        HOST-A → HOST-B (same VLAN) arrives with TTL 64: no router touched it. HOST-A → HOST-C (another VLAN) arrives with TTL 63: R1 routed it once. A capture on the SW1↔SW2 trunk shows VID 10 and VID 20 frames; a capture on an access port shows no tag at all.
      </Callout>
    </div>
  );
}

/** The five faults the lab can break, each walked from normal state through evidence and repair to proof. */
function FaultWalks() {
  const allowed = ticketState("allowed");
  const access = ticketState("access");
  const native = ticketState("native");
  const rtr = ticketState("rtr-trunk");
  const subif = ticketState("subif");
  const trunk1 = cli(allowed, "SW1", "cisco", "show interfaces trunk");
  const mac2 = cli(native, "SW2", "cisco", "show mac address-table");
  const trunk2 = cli(rtr, "SW2", "cisco", "show interfaces trunk");
  return (
    <div className="space-y-4">
      <p>These are the five faults of the lab&apos;s tickets. Each one starts from the healthy evidence above and changes one thing. Read the evidence first and compare it with the healthy output, because the difference is the clue. Then see how the investigation questions lead to the cause, how to repair it on both vendors, and what proves the repair.</p>
      <FailureWalk
        title="1 · A VLAN removed from the trunk's allowed list"
        normal={<>The SW1↔SW2 trunk allows 1, 10 and 20 at both ends, and both teams reach their colleagues upstairs.</>}
        change={<>One end of the trunk stops allowing VLAN 10. A classic way: <Mono>switchport trunk allowed vlan 1,20</Mono> typed without <Mono>add</Mono>, which <em>replaces</em> the list (VLAN 10 is gone) instead of extending it.</>}
        evidence={
          <>
            <p>Sales can&apos;t reach Sales across the floors, while Engineering across the same cable is fine, and the link is up. On SW1 the allowed list no longer contains 10:</p>
            <CliPanel run={{ ...trunk1, output: pickLines(trunk1.output, /Gi1\/0\/24|Port/) }} />
            <DiagramFrame caption="The trunk filters VLAN by VLAN: one lane cut, the other untouched.">
              <IncidentDiagram />
            </DiagramFrame>
          </>
        }
        next={<>One VLAN failing on a link that carries another is never physical and never Spanning Tree: either would stop both VLANs. Check the allowed list at <strong>both</strong> ends (<Mono>show interfaces trunk</Mono> · Junos <Mono>show vlans</Mono> or the interface&apos;s <Mono>vlan members</Mono>).</>}
        fix={<>On SW1&apos;s trunk: Cisco <Mono>interface Gi1/0/24</Mono>, <Mono>switchport trunk allowed vlan add 10</Mono> · Junos <Mono>set interfaces ge-0/0/24 unit 0 family ethernet-switching vlan members SALES</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>VLAN 10 is back in the list at that end. HOST-A → HOST-B answers again with TTL 64, and HOST-C → HOST-D was never interrupted.</>}
      />
      <FailureWalk
        title="2 · A host port in the wrong access VLAN"
        normal={<>SW2 Gi1/0/1 is an access port in VLAN 10, and HOST-B&apos;s MAC is learned in VLAN 10.</>}
        change={<>The port is put in VLAN 20 (a re-purposed port, or a typo). HOST-B&apos;s own settings are unchanged: it still has a Sales address.</>}
        evidence={
          <>
            <p>HOST-B reaches nobody, not even its gateway, while everyone else is fine. VLAN 10 has lost its port on SW2, and HOST-B is learned in VLAN 20:</p>
            <CliPanel run={cli(access, "SW2", "cisco", "show vlan brief")} />
            <CliPanel run={cli(access, "SW2", "cisco", "show mac address-table address 0000.5e00.530b")} />
          </>
        }
        next={<>When one host is isolated, look up its MAC: the VLAN column is the truth (<Mono>show mac address-table address</Mono> · <Mono>show ethernet-switching table</Mono>). A Sales address in VLAN 20 has nobody to talk to: its ARP requests reach Engineering hosts, who ignore them.</>}
        fix={<>On SW2: Cisco <Mono>interface Gi1/0/1</Mono>, <Mono>switchport access vlan 10</Mono> · Junos <Mono>delete interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members ENG</Mono>, <Mono>set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members SALES</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>HOST-B&apos;s MAC is re-learned in VLAN 10, and HOST-B reaches HOST-A and its gateway.</>}
      />
      <FailureWalk
        title="3 · The two ends of a trunk disagree on the native VLAN"
        normal={<>Both ends use native VLAN 1: VLANs 10 and 20 cross tagged, VLAN 1 untagged.</>}
        change={<>SW1&apos;s native VLAN becomes 10. SW1 now sends Sales frames <strong>untagged</strong>, and SW2, still on native 1, puts every untagged frame into VLAN 1.</>}
        evidence={
          <>
            <p>Sales across the floors breaks and Engineering works. Nothing is down and nothing is dropped: HOST-A&apos;s frames simply changed VLAN. SW2 learns HOST-A in VLAN 1, and Cisco&apos;s CDP notices the disagreement (Junos has no such check):</p>
            <CliPanel run={{ ...mac2, output: pickLines(mac2.output, /530a|Vlan {4}Mac/) }} note={<>The VLAN 10 row is HOST-A&apos;s entry from before the change and will age out. The new VLAN 1 row is where HOST-A&apos;s frames are going now.</>} />
            <CliPanel run={cli(native, "SW1", "cisco", "show logging")} />
          </>
        }
        next={<>Compare the <Mono>Native vlan</Mono> column at both ends (<Mono>show interfaces trunk</Mono> · Junos <Mono>native-vlan-id</Mono> in <Mono>show configuration interfaces</Mono>). A MAC learned in VLAN 1 that belongs to another VLAN is the giveaway.</>}
        fix={<>Make both ends agree. Back to the default on SW1: Cisco <Mono>interface Gi1/0/24</Mono>, <Mono>no switchport trunk native vlan</Mono> · Junos <Mono>delete interfaces ge-0/0/24 native-vlan-id</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>The same native VLAN at both ends, HOST-A learned in VLAN 10 again on SW2, HOST-A → HOST-B answers, and no new CDP message appears.</>}
      />
      <FailureWalk
        title="4 · The trunk to the router doesn't carry a VLAN"
        normal={<>SW2 Gi1/0/23 (to R1) allows 1, 10 and 20, so both VLANs reach their gateway.</>}
        change={<>VLAN 20 is removed from the trunk toward R1 only.</>}
        evidence={
          <>
            <p>Engineering hosts still reach each other (same VLAN, no router needed), but not their gateway 192.168.20.1, and nothing in Sales. Sales is fine. On SW2, Gi1/0/23 allows only 1 and 10:</p>
            <CliPanel run={{ ...trunk2, output: pickLines(trunk2.output, /Gi1\/0\/2[34]|Port/) }} />
          </>
        }
        next={<>A VLAN that works inside but can&apos;t reach its gateway: follow it toward the router. Is that VLAN allowed on the trunk to R1? Do VID 20 frames leave SW2 on Gi1/0/23 (capture)? If none leave, the cause is on the switch side.</>}
        fix={<>On SW2&apos;s trunk to R1: Cisco <Mono>interface Gi1/0/23</Mono>, <Mono>switchport trunk allowed vlan add 20</Mono> · Junos <Mono>set interfaces ge-0/0/23 unit 0 family ethernet-switching vlan members ENG</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>HOST-C pings 192.168.20.1, then HOST-A, which answers with TTL 63.</>}
      />
      <FailureWalk
        title="5 · R1's subinterface expects the wrong VLAN ID"
        normal={<>Gi0/0.20 (Junos ge-0/0/0.20) uses <Mono>encapsulation dot1Q 20</Mono> (Junos <Mono>vlan-id 20</Mono>).</>}
        change={<>The subinterface&apos;s VLAN ID is changed to 30. The switches are untouched.</>}
        evidence={
          <>
            <p>The same symptom as fault 4 (Engineering can&apos;t reach its gateway), but this time SW2 <em>does</em> send VID 20 frames to R1, and R1 drops them because no subinterface accepts VID 20:</p>
            <CliPanel run={cli(subif, "R1", "cisco", "show interfaces GigabitEthernet0/0")} note={<>The lab names this counter plainly. Real IOS has no line called &quot;unknown-VLAN drops&quot;: such frames are counted among the interface&apos;s input drops.</>} />
            <CliPanel run={cli(subif, "R1", "juniper", "show interfaces ge-0/0/0.20")} note={<>The unit keeps its gateway address, but its tag is VID 30, and nothing in the network is in VLAN 30.</>} />
          </>
        }
        next={<>Same symptom, different evidence: the trunk to R1 carries VLAN 20 (check that first), the frames arrive, and R1&apos;s drop counter grows. Compare each subinterface&apos;s VLAN ID with the VLAN it serves (<Mono>show vlans</Mono> on Cisco R1 · <Mono>show interfaces ge-0/0/0.20</Mono> on Junos).</>}
        fix={<>On R1: Cisco <Mono>interface Gi0/0.20</Mono>, <Mono>encapsulation dot1Q 20</Mono> · Junos <Mono>set interfaces ge-0/0/0 unit 20 vlan-id 20</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>The drop counter stops growing, and HOST-C reaches 192.168.20.1 and HOST-A (TTL 63).</>}
      />
    </div>
  );
}

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the VLAN Lab" onPractice={openLab}>
      Same network plus R1, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const G = { foundation: "Foundation", mech: "The mechanism", state: "State and behavior", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };

export const VLAN_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vld-why", label: "Why VLANs exist", group: G.foundation },
  { id: "vld-domain", label: "A VLAN is a broadcast domain", group: G.foundation },
  { id: "vld-classify", label: "Ingress: the port decides", group: G.mech },
  { id: "vld-tag", label: "The 802.1Q tag", group: G.mech },
  { id: "vld-rules", label: "Ingress and egress rules", group: G.mech },
  { id: "vld-trunk", label: "Trunk rules: allowed and native", group: G.mech },
  { id: "vld-chain", label: "Trunks in a chain", group: G.mech },
  { id: "vld-state", label: "The state each switch builds", group: G.state },
  { id: "vld-broadcast", label: "Broadcasts stay in their VLAN", group: G.state },
  { id: "vld-routing", label: "Between VLANs: router on a stick", group: G.state },
  { id: "vld-svi", label: "SVIs and IRB interfaces", group: G.state },
  { id: "vld-verify", label: "How to verify: four questions", group: G.ops },
  { id: "vld-normal", label: "What healthy looks like", group: G.ops },
  { id: "vld-signatures", label: "Failure signatures", group: G.trouble },
  { id: "vld-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "vld-faults", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "vld-prove", label: "Prove the repair", group: G.trouble },
  { id: "vld-design", label: "Native VLAN and VLAN 1 in real designs", group: G.beyond },
  { id: "vld-scale", label: "Beyond one switch pair", group: G.beyond },
  { id: "vld-myths", label: "Common misconceptions", group: G.master },
  { id: "vld-quiz", label: "Knowledge check", group: G.master },
  { id: "vld-explain", label: "Can you explain it?", group: G.master },
  { id: "vld-practice", label: "Practice in the VLAN Lab", group: G.master },
];

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-classify",
    prompt: "HOST-A sends an untagged frame into SW1 ge-0/0/1, an access port in VLAN 10. Who decided that the frame is in VLAN 10?",
    options: [
      { id: "a", label: "HOST-A, through its network settings" },
      { id: "b", label: "SW1's access port configuration" },
      { id: "c", label: "The IP subnet of the packet inside" },
      { id: "d", label: "R1, the gateway" },
    ],
    correctId: "b",
    explanation: "The ingress port classifies every untagged frame into its access VLAN. The host sends an ordinary frame and never knows its VLAN; the switch does not read the IP header to decide.",
  },
  {
    id: "q-tag",
    prompt: "Where is the 802.1Q tag inserted, and what happens to the original EtherType?",
    options: [
      { id: "a", label: "Before the destination MAC; the EtherType is replaced" },
      { id: "b", label: "After the source MAC; the original EtherType follows the tag" },
      { id: "c", label: "Inside the IP header; the EtherType is unchanged" },
      { id: "d", label: "At the end, before the FCS" },
    ],
    correctId: "b",
    explanation: `The 4-byte tag (TPID ${TPID} + TCI) sits right after the source MAC. The original EtherType (0x0800 for IPv4) is still there after it, and the FCS is recomputed because the bytes changed.`,
  },
  {
    id: "q-allowed",
    prompt: "VLAN 10 stops crossing the SW1↔SW2 trunk while VLAN 20 on the same cable keeps working. What is the most likely cause?",
    options: [
      { id: "a", label: "A bad cable between the switches" },
      { id: "b", label: "Spanning Tree blocking the trunk" },
      { id: "c", label: "VLAN 10 missing from the allowed list at one end" },
      { id: "d", label: "A wrong default gateway on HOST-A" },
    ],
    correctId: "c",
    explanation: "A cable fault or an STP block would stop every VLAN on the link. Only a per-VLAN setting, such as the allowed list, can stop one VLAN while another keeps crossing.",
  },
  {
    id: "q-native",
    prompt: "SW1 uses native VLAN 10 on the trunk; SW2 uses native VLAN 1. What happens to HOST-A's frames toward HOST-B?",
    options: [
      { id: "a", label: "They are dropped at SW2 with an error counter" },
      { id: "b", label: "They cross untagged and SW2 puts them into VLAN 1" },
      { id: "c", label: "They cross tagged VID 10 as usual" },
      { id: "d", label: "SW2 rejects the trunk and shuts it down" },
    ],
    correctId: "b",
    explanation: "SW1 sends its native VLAN untagged; SW2 assigns untagged frames to its own native VLAN, 1. Nothing is dropped: the frames silently change VLAN, which is why the mismatch is so confusing.",
  },
  {
    id: "q-ttl",
    prompt: "HOST-A pings HOST-C (VLAN 20). The reply arrives with TTL 63. What does that prove?",
    options: [
      { id: "a", label: "The frame was switched directly between the VLANs" },
      { id: "b", label: "One router hop (R1) forwarded it between the VLANs" },
      { id: "c", label: "The trunk removed one hop of TTL" },
      { id: "d", label: "The native VLAN was used" },
    ],
    correctId: "b",
    explanation: "Switches never touch the TTL. Crossing from VLAN 10 to VLAN 20 needs a router: R1 builds a new frame, decrements the TTL from 64 to 63 and sends it back up the trunk tagged VID 20.",
  },
  {
    id: "q-subif",
    prompt: "What ties R1's subinterface Gi0/0.20 to VLAN 20?",
    options: [
      { id: "a", label: "Its number, .20" },
      { id: "b", label: "Its IP address in 192.168.20.0/24" },
      { id: "c", label: "encapsulation dot1Q 20 (Junos vlan-id 20)" },
      { id: "d", label: "The switch port it is cabled to" },
    ],
    correctId: "c",
    explanation: "The subinterface number is only a name. The 802.1Q VLAN ID configured on it decides which tagged frames it accepts; with the wrong ID, R1 drops VID 20 frames even though the address is right.",
  },
];

export function VlanDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="vld-why" eyebrow="Foundation" title="Why VLANs exist" tone="violet">
        <p>
          You know from Switching how SW1 and SW2 behave on their own: they learn MAC addresses, forward known unicast to one port, and flood broadcasts and unknown unicast out of every other port. Every host on both switches is in one <strong>broadcast domain</strong>. In this lesson&apos;s office that means Sales (HOST-A, HOST-B) and Engineering (HOST-C, HOST-D) hear each other&apos;s every broadcast.
        </p>
        <DiagramFrame caption="Without VLANs, HOST-A's ARP request reaches all three other hosts, whichever team they belong to.">
          <FlatDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Every broadcast reaches everyone", body: "ARP, DHCP and any misbehaving application's floods land on every machine. The more hosts, the more noise for all of them.", tone: "danger" },
            { title: "Nothing separates the teams", body: "Any host reaches any other directly at Layer 2. There is no point where a policy could be applied between them.", tone: "warning" },
            { title: "The obvious fix is expensive", body: "Separate switches and cables per team would work, at twice the hardware and with no flexibility when someone moves desks.", tone: "violet" },
          ]}
        />
        <p>A VLAN solves this inside the switches: one set of hardware, several separate LANs.</p>
      </GuideSection>

      <GuideSection id="vld-domain" eyebrow="Foundation" title="A VLAN is a broadcast domain the switches create" tone="cyan">
        <p>
          Each switch port is assigned to a VLAN, and the switch keeps the VLANs apart: a frame in VLAN 10 is only ever forwarded to VLAN 10 ports. Everything you learned in Switching still happens, separately inside each VLAN. Here Sales is <strong>VLAN 10</strong> (<Mono>192.168.10.0/24</Mono>) and Engineering is <strong>VLAN 20</strong> (<Mono>192.168.20.0/24</Mono>).
        </p>
        <DiagramFrame caption="The same hardware, two LANs. VLAN 10 is cyan, VLAN 20 violet; the trunk between the floors carries both.">
          <TopologyDiagram />
        </DiagramFrame>
        <Callout tone="violet" title="Three rules that carry the whole subject">
          The <strong>access port</strong> decides which VLAN a host&apos;s frames are in, and the host knows nothing about it. Only a <strong>trunk</strong> carries the VLAN inside the frame, as an 802.1Q tag. Only a <strong>router</strong> moves traffic from one VLAN to another.
        </Callout>
        <p>One VLAN is one IP subnet, by design. The subnet is not what separates the VLANs (the switch never reads it); it is what lets a router route between them.</p>
      </GuideSection>

      <GuideSection id="vld-classify" eyebrow="The mechanism" title="Ingress: the port decides the VLAN" tone="cyan">
        <p>
          Classification is the first thing a VLAN-aware switch does with every frame, before learning and lookup. HOST-A sends an ordinary, untagged frame into SW1 <Mono>ge-0/0/1</Mono>, an access port in VLAN 10, so the frame is in VLAN 10. An access port belongs to exactly one VLAN and only ever sends frames of that VLAN, untagged.
        </p>
        <p>
          Because the port decides, moving a host to another VLAN means changing <strong>two</strong> things: the port&apos;s access VLAN, and the host&apos;s address and gateway in the new subnet. A laptop with a Sales address plugged into a VLAN 20 port is in Engineering the moment it sends a frame: its ARP requests reach HOST-C and HOST-D, who ignore them, and its own team never hears it. The switch half of moving HOST-D into Sales:
        </p>
        <CompareCards
          items={[
            { title: "Cisco IOS · SW2", tone: "cyan", tag: "per port", points: ["configure terminal", "interface Gi1/0/2", "switchport mode access", "switchport access vlan 10", "end (a VLAN that doesn't exist yet is created for you)"] },
            { title: "Junos · SW2 (EX, ELS)", tone: "violet", tag: "candidate → commit", points: ["configure", "delete interfaces ge-0/0/2 unit 0 family ethernet-switching vlan members ENG", "set interfaces ge-0/0/2 unit 0 family ethernet-switching vlan members SALES", "show | compare, then commit (the VLAN must exist under vlans, or the commit is refused)"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vld-tag" eyebrow="The mechanism" title="The 802.1Q tag" tone="violet">
        <p>
          The cable between the floors carries both VLANs, so the receiving port alone can&apos;t tell SW2 which VLAN a frame belongs to. On a <strong>trunk</strong>, the sender inserts a 4-byte 802.1Q tag after the source MAC: TPID <Mono>{TPID}</Mono> (&quot;a tag follows&quot;) and the 16-bit TCI that carries the VLAN ID.
        </p>
        <DiagramFrame caption="Inside the tag. It goes after the source MAC and doesn't replace the EtherType.">
          <TagDiagram />
        </DiagramFrame>
        <FieldTable
          title="VID values"
          columns={["VID", "Meaning"]}
          rows={[
            ["0", "Priority-tagged frame: no VLAN, but the PCP priority is used"],
            ["1", "The default VLAN on most switches (and the default native VLAN on Cisco)"],
            ["2–4094", "Usable VLAN IDs"],
            ["4095", "Reserved"],
          ]}
        />
        <DiagramFrame caption="The tag adds 4 bytes to the header, not to the payload MTU.">
          <SizeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vld-rules" eyebrow="The mechanism" title="Ingress and egress rules" tone="success">
        <p>Every VLAN-aware switch applies the same three steps to every frame. Learn them once and every VLAN behavior, and every VLAN fault, follows from them:</p>
        <DiagramFrame caption="Classify on ingress, forward within the VLAN, and let the egress port decide tagged or untagged.">
          <RulesDiagram />
        </DiagramFrame>
        <p>Applied to one HOST-A → HOST-B frame, the three links see three different versions of it:</p>
        <DiagramFrame caption="Adding or removing the tag changes the frame's bytes, so the FCS is recomputed each time.">
          <JourneyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vld-trunk" eyebrow="The mechanism" title="Trunk rules: the allowed list and the native VLAN" tone="warning">
        <p>A trunk belongs to many VLANs. Two settings decide what it really carries, and they are configured at <em>each</em> end:</p>
        <FlowSteps
          steps={[
            { title: "The allowed list", body: <>Each end carries only the VLANs it allows. Cisco: <Mono>switchport trunk allowed vlan 1,10,20</Mono>. Beware: without <Mono>add</Mono> it <em>replaces</em> the list. Junos: the interface&apos;s <Mono>vlan members</Mono>. Remove VLAN 10 at one end and VLAN 10 stops crossing, while VLAN 20 and the link stay up.</>, tone: "warning" },
            { title: "The native VLAN", body: <>One VLAN per trunk crosses <strong>untagged</strong>: VLAN 1 by default on Cisco. Untagged frames arriving on the trunk go into it. Cisco: <Mono>switchport trunk native vlan</Mono>. Junos: <Mono>native-vlan-id</Mono> (the VLAN must also be a member).</>, tone: "cyan" },
            { title: "Both ends must agree", body: "Different allowed lists cut a VLAN. Different native VLANs make frames change VLAN in transit: the most confusing VLAN fault, because nothing looks broken.", tone: "danger" },
          ]}
        />
        <DiagramFrame caption="Native VLAN mismatch: a frame changes VLAN without anything being dropped.">
          <NativeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vld-chain" eyebrow="The mechanism" title="Trunks in a chain" tone="violet">
        <DiagramFrame caption="Tags survive every trunk. Only access ports strip them.">
          <ChainDiagram />
        </DiagramFrame>
        <p>Every trunk along the path must allow the VLAN, at both ends. One missing entry anywhere is enough to break that VLAN end to end, which is exactly the guided lesson&apos;s incident.</p>
      </GuideSection>

      <GuideSection id="vld-state" eyebrow="State and behavior" title="The state each switch builds" tone="cyan">
        <p>A VLAN-aware switch keeps three pieces of state. Every verification and every fault later on is about one of them:</p>
        <FlowSteps
          steps={[
            { title: "VLAN membership", body: "Which VLANs exist (Junos names them: SALES = 10, ENG = 20) and which access ports belong to each.", tone: "violet" },
            { title: "What each trunk carries", body: "Its allowed VLANs and its native VLAN, at each end.", tone: "warning" },
            { title: "The MAC table, per VLAN", body: "Every entry is a (VLAN, MAC) → port pair. A lookup in VLAN 20 only ever matches VLAN 20 entries, and the same MAC can appear in two VLANs as two separate entries.", tone: "cyan" },
          ]}
        />
        <DiagramFrame caption="Every FDB entry is a (VLAN, MAC) pair. The trunk appears in both VLANs' views.">
          <FdbDiagram />
        </DiagramFrame>
        <p>A router on a stick adds a fourth piece: one subinterface per VLAN, each with its VLAN ID and its gateway address.</p>
      </GuideSection>

      <GuideSection id="vld-broadcast" eyebrow="State and behavior" title="Broadcasts stay in their VLAN" tone="warning">
        <p>HOST-A&apos;s ARP request is flooded to VLAN 10 ports only, on both switches; on the trunk it travels tagged VID 10. HOST-C, one port away on SW1, never sees it. HOST-B answers, and from then on HOST-A → HOST-B is known unicast in VLAN 10. No router is involved, so the ping arrives with <strong>TTL 64</strong>.</p>
        <DiagramFrame caption="Flooding only uses ports that are members of the frame's VLAN. This isolation comes from VLAN membership, not from IP subnets.">
          <BroadcastDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vld-routing" eyebrow="State and behavior" title="Between VLANs: router on a stick" tone="ip">
        <p>HOST-A → HOST-C is another subnet, so HOST-A sends the packet to its default gateway, 192.168.10.1. No amount of switching moves a frame from VLAN 10 into VLAN 20. The packet goes down to R1 tagged VID 10. R1 routes it: it builds a <strong>new</strong> frame with new MAC addresses, lowers the TTL from 64 to 63, and sends it back up the same cable tagged VID 20. It crosses the SW1↔SW2 trunk a second time and reaches HOST-C. This round trip is the hairpin.</p>
        <DiagramFrame caption="One cable to R1, two subinterfaces. The ping crosses SW1↔SW2 twice: once per VLAN.">
          <RouterOnAStickDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Cisco IOS · R1", tone: "cyan", tag: "subinterfaces", points: ["interface Gi0/0.10", " encapsulation dot1Q 10", " ip address 192.168.10.1 255.255.255.0", "interface Gi0/0.20 · encapsulation dot1Q 20 · ip address 192.168.20.1 255.255.255.0"] },
            { title: "Junos · R1", tone: "violet", tag: "units", points: ["set interfaces ge-0/0/0 vlan-tagging", "set interfaces ge-0/0/0 unit 10 vlan-id 10", "set interfaces ge-0/0/0 unit 10 family inet address 192.168.10.1/24", "unit 20: vlan-id 20, address 192.168.20.1/24, then commit"] },
          ]}
        />
        <p>What ties a subinterface to its VLAN is its 802.1Q VLAN ID. Its number (<Mono>.10</Mono>) is only a name.</p>
        <Callout tone="success" title="Two numbers tell you which case you are in" icon="✓">
          TTL 64 at the receiver: same VLAN, switched only. TTL 63: another VLAN, routed once by R1.
        </Callout>
      </GuideSection>

      <GuideSection id="vld-svi" eyebrow="State and behavior" title="SVIs and IRB interfaces: the same job inside a switch" tone="ip">
        <DiagramFrame caption="A Layer-3 switch routes between its own VLANs internally; the frame still changes VLAN only by being routed.">
          <L3Diagram />
        </DiagramFrame>
        <p>Larger networks route between VLANs inside a Layer-3 switch instead of a separate router: one routed interface per VLAN, Cisco <Mono>interface Vlan10</Mono> (an SVI) or Junos <Mono>irb.10</Mono>. There is no hairpin over a trunk, but the rule is the same: crossing VLANs is routing, with a new frame and a TTL decrement. The VLAN Lab uses a router on a stick so you can see every step.</p>
      </GuideSection>

      <GuideSection id="vld-verify" eyebrow="Operations" title="How to verify: four questions, one command each" tone="success">
        <p>Verifying VLANs means asking the devices for the state above. Ask the same four questions every time, on both switches:</p>
        <FlowSteps
          steps={[
            { title: "Which VLAN is each port in?", body: <>Cisco <Mono>show vlan brief</Mono> (access ports only; trunks are not listed) · Junos <Mono>show vlans</Mono> (every member, trunks too).</>, tone: "violet" },
            { title: "What does each trunk carry, and with which native VLAN?", body: <>Cisco <Mono>show interfaces trunk</Mono> · Junos <Mono>show ethernet-switching interface</Mono> or <Mono>show configuration interfaces ge-0/0/24</Mono>.</>, tone: "warning" },
            { title: "In which VLAN was each MAC learned?", body: <>Cisco <Mono>show mac address-table</Mono> (or <Mono>… address 0000.5e00.530b</Mono>) · Junos <Mono>show ethernet-switching table</Mono>.</>, tone: "cyan" },
            { title: "Does each VLAN have its gateway?", body: <>On R1: Cisco <Mono>show vlans</Mono> and <Mono>show ip interface brief</Mono> · Junos <Mono>show interfaces ge-0/0/0.10</Mono> and <Mono>show interfaces terse</Mono>.</>, tone: "ip" },
          ]}
        />
        <p>Configuration tells you what someone intended. Only <strong>traffic</strong> proves the result: a ping inside each VLAN, one between them, and a capture on the trunk (tagged) and on an access port (untagged). Cisco also logs native VLAN mismatches (<Mono>show logging</Mono>); Junos doesn&apos;t, so there you compare both ends&apos; configuration.</p>
      </GuideSection>

      <GuideSection id="vld-normal" eyebrow="Operations" title="What a healthy VLAN network looks like on the devices" tone="success">
        <NormalState />
      </GuideSection>

      <GuideSection id="vld-signatures" eyebrow="Troubleshooting" title="Failure signatures: same complaint, different evidence" tone="danger">
        <p>Almost every VLAN fault reaches you as the same sentence: &quot;I can&apos;t reach X&quot;. What tells the causes apart is <em>who</em> is affected and <em>what</em> the devices show:</p>
        <FailureSignatures
          items={[
            { tag: "allowed", title: "A VLAN missing from a trunk", tone: "warning", points: ["One VLAN fails across the switches, the other works", "No frames of that VID in a capture on the trunk", "show interfaces trunk: the VLAN is absent at one end"] },
            { tag: "access", title: "A host port in the wrong VLAN", tone: "violet", points: ["One host can't reach its own subnet or its gateway", "Its MAC is learned in the other VLAN", "Its broadcasts reach the other team"] },
            { tag: "native", title: "A native VLAN mismatch", tone: "danger", points: ["Works one way only, or hosts appear in VLAN 1", "Frames cross the trunk untagged and change VLAN", "Cisco: CDP-4-NATIVE_VLAN_MISMATCH in show logging"] },
            { tag: "router", title: "A VLAN that doesn't reach its gateway", tone: "ip", points: ["Inside the VLAN fine; to the gateway and beyond fails", "No frames of that VID toward R1: the trunk to R1", "Frames arrive and R1 drops them: the wrong VLAN ID on its subinterface"] },
          ]}
        />
        <Callout tone="warning" title="Never stop at “the link is up”" icon="!">
          A trunk can be up and still not carry your VLAN. A physical fault or a Spanning Tree block would stop every VLAN on the link, so one VLAN failing while another works is always a VLAN setting.
        </Callout>
      </GuideSection>

      <GuideSection id="vld-workflow" eyebrow="Troubleshooting" title="Investigation workflow: follow the VLAN, link by link" tone="danger">
        <p>Work through these questions in order. Each one rules out a family of causes before you look at the next, and each uses one of the four verification commands:</p>
        <TroubleshootingFlow
          steps={[
            { question: "Same VLAN, or between VLANs?", look: "Same subnet: only the switches are involved. Another subnet: the gateway (R1) too. Reproduce the failing test and note the TTL of anything that does arrive." },
            { question: "Is each host's port in the VLAN of its subnet?", look: <>show vlan brief / show interfaces &lt;if&gt; switchport · show vlans. A Sales address on a VLAN 20 port is isolated from Sales.</> },
            { question: "In which VLAN did the switch learn the host?", look: "show mac address-table address <mac> · show ethernet-switching table. The VLAN column is the truth." },
            { question: "Does the trunk carry the VLAN at BOTH ends, with the same native VLAN?", look: "show interfaces trunk on both switches (allowed, active, native) · Junos: show vlans and the interface's native-vlan-id. Cisco also logs native mismatches (show logging)." },
            { question: "Between VLANs: does the VLAN reach R1 with the VLAN ID its subinterface expects?", look: "A capture on SW2's port to R1: do frames of that VID leave? Then on R1: show vlans / show interfaces ge-0/0/0.20, and its drops." },
          ]}
        />
        <ChecklistCard tone="warning" title="Don't" mark="✕" items={["Bounce a trunk that is carrying other VLANs fine", "Move hosts between VLANs to “fix” reachability", <>Look for IP routing problems between hosts in the <Mono>same</Mono> VLAN</>]} />
      </GuideSection>

      <GuideSection id="vld-faults" eyebrow="Troubleshooting" title="Five faults, from evidence to proof" tone="danger">
        <FaultWalks />
      </GuideSection>

      <GuideSection id="vld-prove" eyebrow="Troubleshooting" title="Prove the repair with fresh traffic" tone="success">
        <p>An accepted command isn&apos;t a repaired network. After every VLAN fix, prove it the same way:</p>
        <ChecklistCard
          tone="success"
          title="The proof, every time"
          mark="✓"
          items={[
            "Repeat the exact test that failed, and see it succeed",
            "Check the device state the fault had changed (the allowed list, the access VLAN, the native VLAN, the subinterface's VLAN ID)",
            "One fresh test inside each VLAN (TTL 64) and one between the VLANs (TTL 63)",
            "A capture on the trunk shows the right VID; a capture on an access port shows no tag",
            "Whatever was working before still works: the other VLAN was never interrupted",
          ]}
        />
        <p>The lab&apos;s tickets check exactly this: a ticket only closes when the device state is right <em>and</em> a fresh run of the user&apos;s test succeeds.</p>
      </GuideSection>

      <GuideSection id="vld-design" eyebrow="Beyond this lesson" title="Native VLAN and VLAN 1 in real designs" tone="warning">
        <p>The lab keeps the defaults so you can see them. Production designs usually don&apos;t:</p>
        <FlowSteps
          steps={[
            { title: "Don't carry users in VLAN 1", body: "VLAN 1 is the default everywhere, and many control protocols use it. Put users in their own VLANs and leave VLAN 1 empty.", tone: "violet" },
            { title: "Make the native VLAN an unused one, or tag it", body: <>An untagged native VLAN lets an attacker on an access port in that VLAN send a frame with two tags: the first is stripped as native, the second carries it into another VLAN (VLAN hopping by double tagging). Use an unused native VLAN, or tag the native VLAN too (Cisco <Mono>vlan dot1q tag native</Mono>).</>, tone: "danger" },
            { title: "Prune trunks to what they need", body: "Allow only the VLANs a trunk must carry. The trunk to R1 needs 10 and 20; it doesn't need every VLAN in the building.", tone: "warning" },
            { title: "Don't let ports negotiate trunking", body: <>Cisco ports can negotiate a trunk with DTP. Set access ports to <Mono>switchport mode access</Mono> and trunks to <Mono>switchport mode trunk</Mono> with <Mono>switchport nonegotiate</Mono>.</>, tone: "cyan" },
          ]}
        />
      </GuideSection>

      <GuideSection id="vld-scale" eyebrow="Beyond this lesson" title="Beyond one switch pair" tone="cyan">
        <p>Two switches and two VLANs show every rule. Larger networks add scale, not new rules:</p>
        <FlowSteps
          steps={[
            { title: "Many switches", body: "Every trunk in the path must allow the VLAN, and Spanning Tree (the next lesson) keeps the redundant trunks loop-free, per VLAN or per instance.", tone: "violet" },
            { title: "More than 4094 VLANs", body: "A provider can stack a second tag (Q-in-Q, IEEE 802.1ad) to carry each customer's VLANs inside its own VLAN.", tone: "warning" },
            { title: "Across a routed network", body: "Data centers stretch Layer-2 segments over IP with overlays such as VXLAN, whose 24-bit identifier replaces the 12-bit VID.", tone: "ip" },
          ]}
        />
      </GuideSection>

      <GuideSection id="vld-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "Hosts know which VLAN they are in.", correction: "Hosts send ordinary untagged frames. The access port decides the VLAN; the host only has an address and a gateway in that VLAN's subnet." },
            { myth: "Different subnets are what keep VLANs apart.", correction: "The switch never reads the IP header. Membership keeps the VLANs apart; the subnet is what lets a router route between them." },
            { myth: "If the trunk is up, every VLAN crosses it.", correction: "Each end carries only its allowed VLANs. A trunk can be up and filter exactly the VLAN you need." },
            { myth: "A native VLAN mismatch drops traffic.", correction: "Nothing is dropped: untagged frames are put into the receiver's native VLAN. They change VLAN silently." },
            { myth: "A switch can forward a frame from VLAN 10 into VLAN 20.", correction: "Only routing crosses VLANs: a new frame, new MACs, TTL minus one. TTL 63 at the receiver is the proof." },
            { myth: "The subinterface number decides its VLAN.", correction: <>Only its 802.1Q VLAN ID does (<Mono>encapsulation dot1Q 20</Mono> · <Mono>vlan-id 20</Mono>). <Mono>.20</Mono> is just a name.</> },
          ]}
        />
      </GuideSection>

      <GuideSection id="vld-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="vld-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: "Why does HOST-C never see HOST-A's ARP request, although both are on SW1?", a: "HOST-A's frame was classified into VLAN 10 by its access port. Flooding only uses ports that are members of the frame's VLAN, and HOST-C's port is in VLAN 20." },
            { q: "Why does one missing entry in an allowed list break a VLAN while the other VLAN keeps working on the same cable?", a: "The trunk filters per VLAN at each end. VLAN 10 has no egress (or is dropped on ingress) at the end that doesn't allow it; VLAN 20 is still allowed, so it crosses as before. A physical fault would stop both." },
            { q: "Why is a native VLAN mismatch so hard to spot?", a: "Nothing goes down and nothing is dropped. The sender sends its native VLAN untagged, the receiver puts untagged frames into its own native VLAN, and the frames simply arrive in the wrong VLAN, where their destination isn't." },
            { q: "Why does HOST-A's ping to HOST-C cross the SW1↔SW2 trunk twice?", a: "The packet goes to R1 in VLAN 10 (tagged VID 10 on the trunks), R1 routes it, and the new frame comes back in VLAN 20 (tagged VID 20) to reach HOST-C on SW1: once down per VLAN." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vld-practice" eyebrow="Practice" title="Practice in the VLAN Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={[
            "Prove a broadcast stays in its VLAN, and catch the same frame tagged on the trunk and untagged on an access port",
            "Move HOST-D into Sales, on the switch and on the host",
            "Cut and restore VLAN 20 toward R1, and change the native VLAN at both ends",
            "Prove the router hairpin with TTL 63",
            "Solve five tickets from evidence, on Cisco IOS or Junos, and prove each repair",
          ]}
        />
        <PresentationBridge>Watch the VLAN lanes, the tag being added and removed, a native-VLAN leak and the router hairpin animated in the VLAN presentation.</PresentationBridge>
        <LabBridge />
      </GuideSection>
    </div>
  );
}
