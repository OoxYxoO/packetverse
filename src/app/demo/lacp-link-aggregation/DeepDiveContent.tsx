import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, FailureSignatures, FlowSteps, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CliPair, CliPanel, FailureWalk, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { LACP_DST, LACP_ETHERTYPE, LAG1_KEY, LAG_NAME, SYSTEMS } from "@/lib/sim-engine/scenarios/lacpLinkAggregation";
import { lcApply, lcClone, lcTicket, lcTicketState, lcWarm, type LcState, type LcSw, type LcTicketId } from "@/lib/sim-engine/scenarios/lacpNet";
import { lcSwitchSets, type LcCliApi } from "./lacp-lab/lcCli";
import { LagPair } from "./guideSvg";
import { PagpSection } from "./PagpSection";
import { ActorPartnerDiagram, BeforeDiagram, FailDiagram, FlowsDiagram, LogicalDiagram, PduDiagram, RestoreDiagram, StatesDiagram } from "./LessonGuideContent";

/**
 * LINK AGGREGATION & LACP DEEP DIVE — the complete study course, taught on the lesson's own SW1/SW2 bundle. Every CLI
 * sample is produced by running the LACP Lab's model and its real Cisco/Junos command sets.
 * Progression: Foundation → The protocol → Traffic → With the rest of the network → Operations → Troubleshooting → Beyond → Master it.
 */

// Real CLI output, run by the lab's own command sets against the lab's model: the guide shows exactly what the lab shows.
function cliApi(s: LcState): LcCliApi {
  const exec = { kind: "exec" } as const;
  return { view: s, act: () => s, ios: { SW1: exec, SW2: exec }, setIos: () => undefined, junosEdit: { SW1: false, SW2: false }, setJunosEdit: () => undefined, cand: { SW1: lcClone(s.cfg.sw.SW1), SW2: lcClone(s.cfg.sw.SW2) }, setCand: () => undefined };
}
const cli = (s: LcState, sw: LcSw, vendor: CliVendor, command: string) => runGuideCli(lcSwitchSets(cliApi(s), sw)[vendor]!, command);
/** A ticket's network after its test ran: the state the student investigates. */
const ticketState = (id: LcTicketId) => lcTicket(id).repro.reduce((acc, a) => lcApply(acc, a), lcTicketState(id, 1));
const WARM = lcWarm();

const K1 = LAG1_KEY.SW1;
const K2 = LAG1_KEY.SW2;

function FrameDiagram() {
  return (
    <DiagramSvg h={190} label={`LACPDU: Ethernet destination ${LACP_DST}, EtherType ${LACP_ETHERTYPE}, Slow Protocols subtype 0x01 version 0x01, Actor TLV, Partner TLV, Collector TLV and Terminator; no IP header`}>
      <DFieldRow x={20} y={16} h={42} fields={[{ label: "Dst MAC", sub: LACP_DST, w: 150, color: D.eth, strong: true }, { label: "Src MAC", sub: "member port", w: 110, color: D.eth }, { label: "EtherType", sub: LACP_ETHERTYPE, w: 90, color: D.eth, strong: true }, { label: "Subtype", sub: "0x01 LACP", w: 90, color: D.violet }, { label: "Version", sub: "0x01", w: 70, color: D.violet }, { label: "…", w: 90, color: D.faint }]} />
      <DFieldRow x={20} y={86} h={42} fields={[{ label: "Actor TLV", sub: "sys · key · port · state", w: 200, color: D.cyan, strong: true }, { label: "Partner TLV", sub: "same fields, learned", w: 200, color: D.success, strong: true }, { label: "Collector", sub: "max delay", w: 100, color: D.faint }, { label: "Term.", w: 100, color: D.faint }]} />
      <text x={20} y={156} fill={D.text} fontSize={10.5} fontWeight={700}>
        Slow Protocols: link-local, rate-limited control frames between directly connected devices.
      </text>
      <text x={20} y={176} fill={D.muted} fontSize={10}>
        No IPv4, UDP or TCP. LACPDUs are consumed on the member link and never forwarded.
      </text>
    </DiagramSvg>
  );
}

function IdsDiagram() {
  return (
    <DiagramSvg h={150} label="LACP identities: System ID is system priority plus system MAC; Port ID is port priority plus port number; Key groups a system's own ports">
      <DFieldRow x={40} y={20} h={40} fields={[{ label: "System Priority", sub: "e.g. 32768", w: 160, color: D.violet, strong: true }, { label: "System (MAC)", sub: "e.g. 00:00:5E:00:53:11", w: 220, color: D.violet }]} />
      <DFieldRow x={40} y={76} h={40} fields={[{ label: "Port Priority", sub: "e.g. 32768", w: 160, color: D.cyan, strong: true }, { label: "Port Number", sub: "e.g. 23", w: 120, color: D.cyan }]} />
      <text x={470} y={44} fill={D.text} fontSize={10} fontWeight={700}>
        = System ID
      </text>
      <text x={370} y={100} fill={D.text} fontSize={10} fontWeight={700}>
        = Port ID
      </text>
      <text x={40} y={140} fill={D.muted} fontSize={10}>
        The Key (e.g. 10 on SW1, 20 on SW2) is separate: a local label for ports that may aggregate together.
      </text>
    </DiagramSvg>
  );
}

function BitsDiagram() {
  return (
    <DiagramSvg h={250} label="The eight LACP state flags: Activity, Timeout, Aggregation, Synchronization, Collecting, Distributing, Defaulted, Expired, with their bit values">
      <DTable
        x={20}
        y={8}
        title="Actor / Partner State byte"
        cols={[
          { label: "BIT", w: 60 },
          { label: "FLAG", w: 150 },
          { label: "SET MEANS", w: 390 },
        ]}
        rows={[
          ["0x01", "Activity", "Active mode (sends LACPDUs on its own)"],
          ["0x02", "Timeout", "short timeout (fast LACPDUs); clear = long"],
          ["0x04", "Aggregation", "this port may aggregate (not Individual)"],
          ["0x08", "Synchronization", "attached to the right aggregator"],
          ["0x10", "Collecting", "accepting frames on this member"],
          ["0x20", "Distributing", "sending frames on this member"],
          ["0x40", "Defaulted", "using default partner info (none received)"],
          ["0x80", "Expired", "partner info timed out"],
        ]}
        rowH={23}
      />
    </DiagramSvg>
  );
}

function ModesDiagram() {
  return (
    <DiagramSvg h={170} label="Active and Passive: Active with Active forms, Active with Passive forms, Passive with Passive never exchanges LACPDUs and does not form; the physical link stays up">
      <DTable
        x={80}
        y={8}
        title="Does a negotiated bundle form?"
        cols={[
          { label: "SIDE A", w: 120 },
          { label: "SIDE B", w: 120 },
          { label: "RESULT", w: 240 },
        ]}
        rows={[
          ["Active", "Active", "forms — both send"],
          ["Active", "Passive", "forms — Passive answers"],
          ["Passive", "Passive", "no LACPDUs → no bundle"],
        ]}
        highlight={{ row: 2, color: D.danger }}
        rowH={24}
      />
      <text x={80} y={150} fill={D.muted} fontSize={10}>
        Passive is not &quot;disabled&quot;: the link is up; it just waits to be spoken to.
      </text>
    </DiagramSvg>
  );
}

function TimeoutDiagram() {
  return (
    <DiagramSvg h={140} label="Long timeout: LACPDUs every 30 seconds, partner info expires after 90 seconds; short timeout: every second, expires after 3 seconds">
      <DNode x={160} y={50} label="Long timeout" sub="LACPDU every 30 s · expire 90 s" accent={D.violet} w={250} />
      <DNode x={480} y={50} label="Short timeout" sub="LACPDU every 1 s · expire 3 s" accent={D.warning} w={250} />
      <text x={320} y={108} textAnchor="middle" fill={D.muted} fontSize={10}>
        The partner requests the rate via its Timeout flag. Short detects silent failures faster, at more control traffic.
      </text>
      <text x={320} y={126} textAnchor="middle" fill={D.muted} fontSize={10}>
        A physical link-down is noticed immediately either way.
      </text>
    </DiagramSvg>
  );
}

function DistDiagram() {
  return (
    <DiagramSvg h={220} label="Collection and distribution: LACP produces the eligible member set; the forwarding system's hash maps each flow to one eligible member">
      <DNode x={110} y={50} label="LACP" sub="eligible members" accent={D.violet} w={150} />
      <DArrow x1={186} y1={50} x2={250} y2={50} color={D.muted} />
      <DNode x={330} y={50} label="Forwarding hash" sub="implementation-specific" accent={D.cyan} w={160} />
      <DArrow x1={411} y1={40} x2={478} y2={24} color={D.cyan} />
      <DArrow x1={411} y1={60} x2={478} y2={78} color={D.success} />
      <DNode x={550} y={24} label="member 1" sub="flows A, C" accent={D.cyan} w={130} h={36} />
      <DNode x={550} y={80} label="member 2" sub="flows B, D" accent={D.success} w={130} h={36} />
      <text x={20} y={140} fill={D.text} fontSize={10.5} fontWeight={700}>
        Typical hash inputs: MACs, IPs, L4 ports, VLAN — varies by platform and configuration.
      </text>
      <text x={20} y={160} fill={D.muted} fontSize={10}>
        One flow → one member keeps packets in order. When the eligible set changes, flows are re-mapped.
      </text>
      <text x={20} y={180} fill={D.muted} fontSize={10}>
        The lesson&apos;s formula, (src + dst last octet) mod members, is a PacketVerse teaching model only.
      </text>
    </DiagramSvg>
  );
}

function StpDiagram() {
  return (
    <DiagramSvg h={220} label="Spanning tree sees a healthy LAG as one logical port and one path; it does not block individual synchronized members">
      <LagPair m23="dist" m24="dist" lag={`STP sees ONE port: ${LAG_NAME}`} labels={{ m23: "member", m24: "member" }} subs={{ SW1: "STP port LAG1", SW2: "STP port LAG1" }} />
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        LACP: which members, and are they healthy? STP: which logical paths forward? Separate state machines.
      </text>
    </DiagramSvg>
  );
}

function VlanDiagram() {
  return (
    <DiagramSvg h={150} label="A LAG can be an 802.1Q trunk: VLAN tagging and allowed-VLAN lists are configured on the logical LAG, and every member carries the same tagged frames">
      <DNode x={120} y={60} label="LAG1 (logical)" sub="802.1Q trunk · VLANs 10, 20" accent={D.cyan} w={200} h={50} />
      <DArrow x1={222} y1={52} x2={380} y2={36} color={D.cyan} />
      <DArrow x1={222} y1={68} x2={380} y2={86} color={D.cyan} />
      <DNode x={470} y={36} label="ge-0/0/23" sub="same trunk settings" accent={D.success} w={170} h={36} />
      <DNode x={470} y={86} label="ge-0/0/24" sub="same trunk settings" accent={D.success} w={170} h={36} />
      <text x={20} y={136} fill={D.muted} fontSize={10}>
        Configure VLANs on the LAG, not per member: members with different settings can&apos;t aggregate cleanly.
      </text>
    </DiagramSvg>
  );
}

/** What a healthy bundle looks like, read from both switches — the state every later section refers to. */
function NormalState() {
  const sum = cli(WARM, "SW1", "cisco", "show etherchannel summary");
  const nb = cli(WARM, "SW1", "cisco", "show lacp neighbor");
  const stp = cli(WARM, "SW1", "cisco", "show spanning-tree");
  return (
    <div className="space-y-5">
      <p>
        Before anything breaks, learn what a healthy bundle looks like. This is the lab&apos;s network after a normal morning: ge-0/0/23 and ge-0/0/24 are bundled into one logical link on each switch (Cisco Po1 · Junos ae0), and the hosts have pinged across it. The third cable, ge-0/0/22, is a spare and not plugged in. Below are the verification questions, asked on the real switches, with the state described above in the answers. Every output is exactly what the LACP Lab prints, and in the five faults below you will compare broken output with it.
      </p>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">1 · Is the bundle up, and which members carry traffic?</h4>
        <CliPair cisco={{ ...sum, output: pickLines(sum.output, /^(Group|-{6}|\d )/) }} junos={cli(WARM, "SW1", "juniper", "show lacp interfaces")} ciscoCaption="SW1 · Cisco IOS" junosCaption="SW1 · Junos" />
        <p className="text-sm text-pv-text-muted">
          Cisco: <Mono>Po1(SU)</Mono> means Layer 2 and in use, and <Mono>(P)</Mono> on a member means bundled: it carries traffic. Junos says the same per member: <Mono>Dist Col Syn Aggr</Mono> all Yes for the Actor (SW1) and the Partner (SW2), and Mux State <Mono>Collecting distributing</Mono>. A member that is up but not in the bundle would show <Mono>(s)</Mono> (suspended) or a Mux State that never reaches distributing.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">2 · Who is at the other end of each member?</h4>
        <CliPanel run={{ ...nb, output: pickLines(nb.output, /^(Channel|Port|Gi1| +LACP)/) }} />
        <p className="text-sm text-pv-text-muted">
          Both members lead to the same partner: system 0000.5e00.5322 (SW2), with the same operational key <Mono>0x1</Mono>. The key names the partner&apos;s group: on Cisco it is simply the channel-group number, so Po1 → key 1. Flags <Mono>SA</Mono>: the partner asks for slow LACPDUs and is in active mode. Same system and same key on every member is what lets them share one aggregator.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">3 · What does spanning tree see?</h4>
        <CliPanel run={{ ...stp, output: pickLines(stp.output, /^(Interface|-{5}|Gi1|Po1)/) }} />
        <p className="text-sm text-pv-text-muted">
          One port, <Mono>Po1</Mono>, with cost 10000 (20000 shared by two members). Spanning tree never sees the member cables, so it has nothing to block: both cables forward at once. Without the bundle, the two cables would be two parallel links and spanning tree would block one of them.
        </p>
      </div>
      <Callout tone="success" title="And the traffic proves it" icon="✓">
        HOST-A → HOST-B and HOST-A → HOST-C are two flows. The lab&apos;s modeled hash (last octet of source + destination IPv4, mod the number of members) puts them on different members, so both cables carry traffic. One flow always stays on one member, so its frames never arrive out of order.
      </Callout>
    </div>
  );
}

/** The five faults the lab can break, each walked from normal state to proof. */
function FaultWalks() {
  const st = ticketState("static");
  const grp = ticketState("group");
  const pas = ticketState("passive");
  const rate = ticketState("rate");
  const rateLater = lcApply(rate, { type: "wait", seconds: 90 });
  const nolag = ticketState("nolag");
  const summ = /^(Group|-{6}|\d |\(no)/;
  const s1 = cli(st, "SW1", "cisco", "show etherchannel summary");
  const s2 = cli(st, "SW2", "cisco", "show etherchannel summary");
  const gNb = cli(grp, "SW1", "cisco", "show lacp neighbor");
  const gSum = cli(grp, "SW2", "cisco", "show etherchannel summary");
  const pInt = cli(pas, "SW1", "cisco", "show lacp internal");
  const rInt = cli(rate, "SW1", "cisco", "show lacp internal");
  const rLog = cli(rateLater, "SW1", "cisco", "show logging");
  const nSum = cli(nolag, "SW1", "cisco", "show etherchannel summary");
  const nStp = cli(nolag, "SW2", "cisco", "show spanning-tree");
  return (
    <div className="space-y-4">
      <p>These are the five faults of the lab&apos;s tickets. Each one starts from the healthy evidence above and changes one thing. Read the evidence first and compare it with the healthy output, because the difference is the clue. Always read <strong>both</strong> ends: a bundle is an agreement, and each end only tells you its half. Then see how the investigation questions lead to the cause, how to repair it on both vendors, and what proves the repair.</p>
      <FailureWalk
        title="1 · One end static, the other end LACP"
        normal={<>Both switches run LACP active on ge-0/0/23 and ge-0/0/24.</>}
        change={<>SW2 is replaced and its uplinks are configured as a static bundle: Cisco <Mono>channel-group 1 mode on</Mono> · Junos ae0 with no <Mono>lacp</Mono> stanza. SW2 now sends no LACPDUs.</>}
        evidence={
          <>
            <p>Nobody on SW1 reaches anybody on SW2, and both cables have link lights. The two ends disagree about the same bundle. SW1 hears no partner, so its members are suspended. SW2 has no protocol to notice anything, so it bundles and forwards into ports SW1 refuses to use:</p>
            <CliPanel run={{ ...s1, output: pickLines(s1.output, summ) }} />
            <CliPanel run={{ ...s2, output: pickLines(s2.output, summ) }} />
          </>
        }
        next={<>Compare the <Mono>Protocol</Mono> column at both ends: <Mono>LACP</Mono> against <Mono>-</Mono> (static). On SW1, <Mono>show lacp neighbor</Mono> lists no partner at all. Static and LACP never mix: pick one, and use LACP so the switches check each other.</>}
        fix={<>On SW2, Cisco: on each member <Mono>no channel-group</Mono>, then <Mono>channel-group 1 mode active</Mono> on each (IOS refuses to mix static and LACP members in one Port-channel, so remove both first). Junos: <Mono>set interfaces ae0 aggregated-ether-options lacp active</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>Both ends show <Mono>Po1(SU)</Mono> with protocol LACP and two <Mono>(P)</Mono> members, and HOST-A reaches HOST-B.</>}
      />
      <FailureWalk
        title="2 · A member in the wrong group"
        normal={<>On both switches, ge-0/0/23 and ge-0/0/24 are in channel-group 1 (Po1 · ae0).</>}
        change={<>On SW2, ge-0/0/24 is put in channel-group 2 (Po2 · ae1). Its LACPDUs now carry key 2 instead of 1.</>}
        evidence={
          <>
            <p>The uplink works, but at half the bandwidth, and both cables are up. On SW1 the two members lead to the same partner system with <strong>different keys</strong>, so they can&apos;t share one aggregator and ge-0/0/24 is left out. SW2 shows the member alone in its own, down Po2:</p>
            <CliPanel run={{ ...gNb, output: pickLines(gNb.output, /^(Port|Gi1| +LACP)/) }} />
            <CliPanel run={{ ...gSum, output: pickLines(gSum.output, summ) }} />
          </>
        }
        next={<>A member that is up but <Mono>(s)</Mono> while the bundle works: compare the partner&apos;s <Mono>Oper Key</Mono> per member in <Mono>show lacp neighbor</Mono>. One different key means one member is in the wrong group on the <em>far</em> switch. The keys only need to match among one switch&apos;s own members: SW1&apos;s key and SW2&apos;s key may differ (the guided lesson uses 10 and 20).</>}
        fix={<>On SW2: Cisco <Mono>interface Gi1/0/24</Mono>, <Mono>channel-group 1 mode active</Mono> · Junos <Mono>set interfaces ge-0/0/24 ether-options 802.3ad ae0</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>Both members <Mono>(P)</Mono> at both ends, and the two flows use both cables again.</>}
      />
      <FailureWalk
        title="3 · Both ends passive"
        normal={<>Both ends are LACP active: each one sends LACPDUs on its own.</>}
        change={<>The configuration is &quot;standardized&quot; to <Mono>mode passive</Mono> on both switches. A passive port only answers LACPDUs, so nobody sends the first one.</>}
        evidence={
          <>
            <p>The Port-channel is down and the floors are cut off. Every member is suspended at both ends. The flags say why: <Mono>SP</Mono> (passive), and on Junos both Actor and Partner show <Mono>Passive</Mono> with Receive State <Mono>Defaulted</Mono>, meaning nothing has ever been heard:</p>
            <CliPair cisco={{ ...pInt, output: pickLines(pInt.output, /^(Channel|Port|Gi1| +LACP)/) }} junos={cli(pas, "SW1", "juniper", "show lacp interfaces")} ciscoCaption="SW1 · Cisco IOS" junosCaption="SW1 · Junos" />
          </>
        }
        next={<>No partner on any member while the cables are up: check the mode at both ends. Passive + passive never starts. Active + passive works, and active + active is the usual choice.</>}
        fix={<>Make at least one end active (both, preferably). On each member: Cisco <Mono>channel-group 1 mode active</Mono> · Junos <Mono>set interfaces ae0 aggregated-ether-options lacp active</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>Members reach <Mono>bndl</Mono> / Collecting distributing, Po1 comes up, and the ping works.</>}
      />
      <FailureWalk
        title="4 · A silent failure and the slow LACP rate"
        normal={<>Both members bundled, LACP at the default slow rate: an LACPDU every 30 s, and a member is dropped only after 90 s of silence.</>}
        change={<>The media converter on ge-0/0/24 dies. The link stays <strong>up</strong>, but no light gets through. Nothing physical tells the switches.</>}
        evidence={
          <>
            <p>Some users lose the network for about 90 seconds while others are fine. For those 90 s ge-0/0/24 still looks perfectly bundled, so the hash keeps sending flows onto a dead cable. The flags still show <Mono>SA</Mono>: S means slow LACPDUs.</p>
            <CliPanel run={{ ...rInt, output: pickLines(rInt.output, /^(Channel|Port|Gi1| +LACP)/) }} />
            <p>Only after 90 s without an LACPDU does LACP remove the member, and the log shows it:</p>
            <CliPanel run={rLog} />
          </>
        }
        next={<>Some flows fail, others don&apos;t, and nothing is down: suspect one member. Look for a member whose counters stop receiving, and check the LACP timeout (Junos <Mono>Timeout Slow</Mono> · Cisco flag <Mono>S</Mono>). A static bundle would <em>never</em> notice this failure.</>}
        fix={<>The fast rate at both ends: Cisco <Mono>lacp rate fast</Mono> on each member · Junos <Mono>set interfaces ae0 aggregated-ether-options lacp periodic fast</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>Repeat the failure: the member leaves the bundle after 3 s and the ping 5 s later works.</>}
      />
      <FailureWalk
        title="5 · No bundle at all"
        normal={<>ge-0/0/23 and ge-0/0/24 form Po1, and spanning tree sees one logical link.</>}
        change={<>The channel-group configuration is removed from the uplinks on both switches. They become two ordinary parallel links.</>}
        evidence={
          <>
            <p>One cable does all the work and the other carries nothing. Nothing is broken: spanning tree is doing its job on two parallel links. SW1 has no channel group, and SW2 blocks its second uplink:</p>
            <CliPanel run={{ ...nSum, output: pickLines(nSum.output, summ) }} />
            <CliPanel run={{ ...nStp, output: pickLines(nStp.output, /^(Interface|-{5}|Gi1)/) }} />
          </>
        }
        next={<>An idle cable plus an Alternate port means spanning tree sees two links where you wanted one. Check that each uplink is in a channel group at both ends (<Mono>show etherchannel summary</Mono> · <Mono>show lacp interfaces</Mono>).</>}
        fix={<>On both switches, both members into the bundle with LACP: Cisco <Mono>channel-group 1 mode active</Mono> on Gi1/0/23 and Gi1/0/24 · Junos <Mono>set interfaces ge-0/0/23 ether-options 802.3ad ae0</Mono>, the same for ge-0/0/24, <Mono>set interfaces ae0 aggregated-ether-options lacp active</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>Spanning tree shows <Mono>Po1</Mono> and no blocked uplink, and the two flows use both cables.</>}
      />
    </div>
  );
}

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the LACP Lab" onPractice={openLab}>
      Same switches, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const G = { foundation: "Foundation", proto: "The protocol", traffic: "Traffic on a bundle", around: "With the rest of the network", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };

export const LACP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lcd-why", label: "Why link aggregation exists", group: G.foundation },
  { id: "lcd-idea", label: "Many cables, one logical link", group: G.foundation },
  { id: "lcd-pdu", label: "The LACPDU", group: G.proto },
  { id: "lcd-ids", label: "Actor, Partner and the key", group: G.proto },
  { id: "lcd-bits", label: "State flags, link-up to forwarding", group: G.proto },
  { id: "lcd-modes", label: "Active, passive and static", group: G.proto },
  { id: "lcd-pagp", label: "PAgP and every mode pair", group: G.proto },
  { id: "lcd-timeout", label: "The LACP rate", group: G.proto },
  { id: "lcd-dist", label: "Distribution and hashing", group: G.traffic },
  { id: "lcd-fail", label: "When a member fails", group: G.traffic },
  { id: "lcd-stp", label: "A bundle and spanning tree", group: G.around },
  { id: "lcd-vlan", label: "A bundle as a trunk", group: G.around },
  { id: "lcd-state", label: "The state each switch keeps", group: G.ops },
  { id: "lcd-verify", label: "How to verify: read both ends", group: G.ops },
  { id: "lcd-normal", label: "What healthy looks like", group: G.ops },
  { id: "lcd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "lcd-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "lcd-faults", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "lcd-prove", label: "Prove the repair", group: G.trouble },
  { id: "lcd-minlinks", label: "Minimum links and hashing", group: G.beyond },
  { id: "lcd-mlag", label: "Bundles across two switches", group: G.beyond },
  { id: "lcd-myths", label: "Common misconceptions", group: G.master },
  { id: "lcd-quiz", label: "Knowledge check", group: G.master },
  { id: "lcd-explain", label: "Can you explain it?", group: G.master },
  { id: "lcd-practice", label: "Practice in the LACP Lab", group: G.master },
];

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-stp",
    prompt: "Two cables join SW1 and SW2, with no bundle configured. What does spanning tree do?",
    options: [
      { id: "a", label: "Uses both cables, one per direction" },
      { id: "b", label: "Blocks one of them: two parallel links are a loop" },
      { id: "c", label: "Nothing: parallel links are not a loop" },
      { id: "d", label: "Bundles them automatically" },
    ],
    correctId: "b",
    explanation: "Two separate links between the same switches are two paths, a loop. Spanning tree keeps one and blocks the other, so the second cable is only a spare. A bundle makes them one logical port with nothing to block.",
  },
  {
    id: "q-keys",
    prompt: `SW1's members use key ${LAG1_KEY.SW1} and SW2's members use key ${LAG1_KEY.SW2}. Can they bundle?`,
    options: [
      { id: "a", label: "No: both switches must use the same key" },
      { id: "b", label: "Yes: a key only groups one switch's own ports" },
      { id: "c", label: "Only in passive mode" },
      { id: "d", label: "Only with a static bundle" },
    ],
    correctId: "b",
    explanation: "The key is local. What must match is that every member on one switch has the same key, and that every member sees the same partner system and partner key.",
  },
  {
    id: "q-passive",
    prompt: "Both ends are configured LACP passive. What happens?",
    options: [
      { id: "a", label: "The bundle forms, slowly" },
      { id: "b", label: "Nothing forms: neither end sends the first LACPDU" },
      { id: "c", label: "The bundle forms as static" },
      { id: "d", label: "One end becomes active automatically" },
    ],
    correctId: "b",
    explanation: "A passive port only answers LACPDUs. With two passive ends nobody starts the conversation, every member stays suspended, and the physical links stay up.",
  },
  {
    id: "q-flow",
    prompt: "A single file transfer runs across a two-member bundle of 1 Gb/s links. How fast can it go?",
    options: [
      { id: "a", label: "2 Gb/s: it uses both members" },
      { id: "b", label: "About 1 Gb/s: one flow stays on one member" },
      { id: "c", label: "500 Mb/s: the members share it" },
      { id: "d", label: "It depends on the LACP rate" },
    ],
    correctId: "b",
    explanation: "The hash pins every frame of a flow to one member so frames arrive in order. The bundle raises total capacity across many flows, not the speed of one.",
  },
  {
    id: "q-silent",
    prompt: "A media converter dies on one member; the link LED stays green. With the default slow rate, when does LACP remove that member?",
    options: [
      { id: "a", label: "Immediately" },
      { id: "b", label: "After 3 seconds" },
      { id: "c", label: "After 90 seconds without an LACPDU" },
      { id: "d", label: "Never" },
    ],
    correctId: "c",
    explanation: "With the slow rate LACPDUs arrive every 30 s and the partner information expires after 3 missed ones: 90 s. The fast rate (every second) notices in 3 s. A static bundle never notices.",
  },
  {
    id: "q-static",
    prompt: "SW1 runs LACP, SW2 a static bundle (mode on). What do you see?",
    options: [
      { id: "a", label: "Both ends up, everything works" },
      { id: "b", label: "SW1 suspends its members; SW2 forwards into ports SW1 refuses to use" },
      { id: "c", label: "Both ends err-disable the ports" },
      { id: "d", label: "SW2 switches to LACP automatically" },
    ],
    correctId: "b",
    explanation: "The LACP end hears no partner, so its members never synchronize. The static end has no protocol to notice anything and bundles anyway. Static and LACP never mix.",
  },
];

export function LacpDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="lcd-why" eyebrow="Foundation" title="Why link aggregation exists" tone="ethernet">
        <p>
          Hosts on two floors talk across one 1 Gb/s uplink between SW1 and SW2. That cable is a bottleneck, and if it fails the floors are cut off. A second cable seems the obvious answer, but you saw in the STP lesson what two cables between the same switches are: two paths, a loop. Spanning tree keeps one and blocks the other, so the second cable carries nothing until the first one fails.
        </p>
        <DiagramFrame caption="Without aggregation, spanning tree has to keep one cable non-forwarding.">
          <BeforeDiagram />
        </DiagramFrame>
        <p>What we want: both cables carrying traffic at the same time, spanning tree seeing nothing to block, and a failed cable costing capacity, not connectivity.</p>
      </GuideSection>

      <GuideSection id="lcd-idea" eyebrow="Foundation" title="Many cables, one logical link" tone="cyan">
        <p>
          Link aggregation (IEEE 802.1AX, formerly 802.3ad) bundles parallel full-duplex links between the same two systems into one logical link: Cisco calls it a <strong>Port-channel</strong> (Po1), Junos an <strong>aggregated Ethernet</strong> interface (ae0), and the guided lesson simply LAG1. To everything above it the bundle is <strong>one port</strong>: the MAC table learns hosts behind Po1, and spanning tree sees one link. There is nothing left to block, so both cables forward.
        </p>
        <DiagramFrame caption="Both members distributing, one logical port above them.">
          <LogicalDiagram />
        </DiagramFrame>
        <Callout tone="ethernet" title="The rule that carries the whole subject">
          LACP decides which members are eligible. The forwarding system decides which eligible member each flow uses.
        </Callout>
      </GuideSection>

      <GuideSection id="lcd-pdu" eyebrow="The protocol" title="The LACPDU" tone="cyan">
        <p>
          On each member cable, LACP sends small frames called LACPDUs to the Slow Protocols address <Mono>{LACP_DST}</Mono> with EtherType <Mono>{LACP_ETHERTYPE}</Mono>. They are link-local and never forwarded. Each member has its own conversation: a bundle of two cables means two LACP exchanges.
        </p>
        <DiagramFrame caption="Slow Protocol frames, one exchange per member.">
          <PduDiagram />
        </DiagramFrame>
        <DiagramFrame caption={`Ethernet → ${LACP_DST} · ${LACP_ETHERTYPE} · subtype 0x01 · Actor + Partner TLVs.`}>
          <FrameDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcd-ids" eyebrow="The protocol" title="Actor, Partner and the key" tone="violet">
        <p>
          Each LACPDU carries the sender&apos;s own fields (the <strong>Actor</strong>) and what it has learned about the other end (the <strong>Partner</strong>). A system identity is a system priority plus a MAC, e.g. <Mono>{`${SYSTEMS.SW1.priority} / ${SYSTEMS.SW1.mac}`}</Mono>: it names the whole switch, not the source of customer frames. The <strong>key</strong> is a local number that groups one switch&apos;s ports: only ports with the same key may share a bundle.
        </p>
        <DiagramFrame caption="Priority + value pairs; lower priority is preferred when a decision must be made.">
          <IdsDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Each LACPDU carries the sender's Actor fields and what it has learned as Partner.">
          <ActorPartnerDiagram />
        </DiagramFrame>
        <p>The guided lesson uses keys {K1} and {K2} to show that the two switches&apos; keys don&apos;t have to match. In the lab, Cisco uses the channel-group number as the key (Po1 → key 1), and both switches happen to use 1. What must hold: every member of one bundle on one switch has the same key, and every member sees the same partner system and partner key.</p>
      </GuideSection>

      <GuideSection id="lcd-bits" eyebrow="The protocol" title="State flags: from link-up to forwarding" tone="ip">
        <p>Each LACPDU carries eight state flags for the Actor and eight for the Partner. A member carries customer traffic only when both ends agree it belongs to the same bundle, and it gets there step by step: the partner is heard and in sync, then <strong>Collecting</strong> (accepting frames), then <strong>Distributing</strong> (sending frames).</p>
        <DiagramFrame caption="Carried separately for Actor and Partner in every LACPDU.">
          <BitsDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Each step needs the partner to have reached the step before.">
          <StatesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcd-modes" eyebrow="The protocol" title="Active, passive and static" tone="warning">
        <DiagramFrame caption="At least one side must start talking.">
          <ModesDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "LACP active / passive", tone: "success", tag: "negotiated", points: ["active + active, active + passive: bundle", "passive + passive: nobody starts, no bundle", "Members must agree on the partner group, or one is suspended", "Cisco: channel-group 1 mode active · Junos: set interfaces ae0 aggregated-ether-options lacp active"] },
            { title: "Static (mode on)", tone: "warning", tag: "no protocol", points: ["Bundles without LACPDUs: no checks at all", "Static + static: bundle (a miswire goes unnoticed)", "Static + LACP: the LACP end suspends its ports; the static end forwards into nothing", "Cisco: channel-group 1 mode on · Junos: ae0 without an lacp stanza"] },
          ]}
        />
      </GuideSection>

      <PagpSection />
      <GuideSection id="lcd-timeout" eyebrow="The protocol" title="The LACP rate" tone="cyan">
        <DiagramFrame caption="How fast a silently failed partner is noticed.">
          <TimeoutDiagram />
        </DiagramFrame>
        <p>The rate matters when a member fails <em>silently</em>: a media converter dies, the link stays up, frames vanish. Only LACP can notice, when its LACPDUs stop arriving. Cisco sets the fast rate per member (<Mono>lacp rate fast</Mono>); Junos sets it on the bundle (<Mono>set interfaces ae0 aggregated-ether-options lacp periodic fast</Mono>).</p>
      </GuideSection>

      <GuideSection id="lcd-dist" eyebrow="Traffic on a bundle" title="Distribution and hashing" tone="success">
        <p>The switch hashes each frame&apos;s addresses to pick one eligible member. Every frame of a flow takes the same member, so frames never arrive out of order, and different flows spread over the members. The lab uses a clearly labeled modeled hash (the last octets of the source and destination IPv4 addresses, modulo the number of members); real platforms hash their own fields.</p>
        <DiagramFrame caption="LACP says which members; the forwarding system says which member per flow.">
          <DistDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Per-flow pinning: one flow, one member; many flows spread out.">
          <FlowsDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Not double speed for one flow" icon="!">
          A single flow stays on one member. A two-member bundle raises the total capacity across many flows; it never stripes one file transfer over both cables.
        </Callout>
      </GuideSection>

      <GuideSection id="lcd-fail" eyebrow="Traffic on a bundle" title="When a member fails, and when it comes back" tone="danger">
        <p>When a member&apos;s cable goes down, its link goes down at both ends, it leaves the bundle at once and the hash moves its flows to the remaining members. The Port-channel stays up and spanning tree notices nothing.</p>
        <DiagramFrame caption="A member fails: its flows are re-hashed onto the surviving member.">
          <FailDiagram />
        </DiagramFrame>
        <p>When the cable comes back, the member renegotiates before it carries traffic again: link up is not &quot;in use&quot;.</p>
        <DiagramFrame caption="Restoring a member: renegotiate first, distribute second.">
          <RestoreDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcd-stp" eyebrow="With the rest of the network" title="A bundle and spanning tree" tone="violet">
        <DiagramFrame caption="One logical path to spanning tree.">
          <StpDiagram />
        </DiagramFrame>
        <p>Spanning tree runs on Po1 / ae0, not on the member cables. Its cost reflects the bundle&apos;s bandwidth (in the lab 10000: two members sharing the 20000 of one link).</p>
        <Callout tone="warning" title="LACP is not a spanning-tree replacement">
          LACP only bundles links between the same two devices. Redundant paths between different switches still need spanning tree, or another loop-free design.
        </Callout>
      </GuideSection>

      <GuideSection id="lcd-vlan" eyebrow="With the rest of the network" title="A bundle as a trunk" tone="ip">
        <DiagramFrame caption="Trunk settings belong on the logical interface.">
          <VlanDiagram />
        </DiagramFrame>
        <p>Configure VLAN trunking on Po1 / ae0. Members whose settings differ from the bundle (speed, duplex, trunk mode, allowed VLANs) are refused or suspended by most platforms, so a bundle is also a consistency check.</p>
      </GuideSection>

      <GuideSection id="lcd-state" eyebrow="Operations" title="The state each switch keeps" tone="cyan">
        <FlowSteps
          steps={[
            { title: "The bundle and its members", body: "Is Po1 / ae0 up, and which members are bundled (P), suspended (s) or down (D)?", tone: "success" },
            { title: "The partner on each member", body: "Which system answered on each cable, with which key, mode and rate. Every member of one bundle must see the same partner system and key.", tone: "violet" },
            { title: "Each member's LACP state", body: "Activity (active/passive), timeout (slow/fast), synchronization, collecting, distributing, and whether the partner is still heard (current/expired).", tone: "warning" },
            { title: "What spanning tree sees", body: "One logical port, Po1 / ae0, instead of separate cables.", tone: "cyan" },
          ]}
        />
      </GuideSection>

      <GuideSection id="lcd-verify" eyebrow="Operations" title="How to verify: read both ends" tone="success">
        <p>A bundle is an agreement, and each end only shows its half. Ask these questions on <strong>both</strong> switches:</p>
        <FlowSteps
          steps={[
            { title: "Is the bundle up, and which members carry traffic?", body: <>Cisco <Mono>show etherchannel summary</Mono> (Po1(SU), members (P)) · Junos <Mono>show lacp interfaces</Mono> (Collecting distributing) and <Mono>show interfaces ae0</Mono>.</>, tone: "success" },
            { title: "Who is the partner on each member?", body: <>Cisco <Mono>show lacp neighbor</Mono> (Dev ID, Oper Key per member) · Junos <Mono>show lacp interfaces</Mono> (Partner rows).</>, tone: "violet" },
            { title: "Which mode and rate does this end use?", body: <>Cisco <Mono>show lacp internal</Mono> (flags SA/SP, F/S) · Junos <Mono>show configuration interfaces ae0</Mono>.</>, tone: "warning" },
            { title: "What does spanning tree see?", body: <>Cisco <Mono>show spanning-tree</Mono> (Po1 as one port) · Junos <Mono>show spanning-tree interface</Mono>.</>, tone: "cyan" },
          ]}
        />
        <p>Then prove it with traffic: several flows, not one, every ping back and at least two members used. Then fail a member and repeat.</p>
      </GuideSection>

      <GuideSection id="lcd-normal" eyebrow="Operations" title="What a healthy bundle looks like on the devices" tone="success">
        <NormalState />
      </GuideSection>

      <GuideSection id="lcd-signatures" eyebrow="Troubleshooting" title="Failure signatures: up cables, missing bandwidth" tone="danger">
        <p>Most aggregation problems leave every link light green. They reach you as &quot;the floors can&apos;t talk&quot;, &quot;the uplink is half as fast&quot;, or &quot;some users lost the network for a minute and a half&quot;:</p>
        <FailureSignatures
          items={[
            { tag: "static", title: "Static on one end, LACP on the other", tone: "danger", points: ["Everything across the uplink fails, links up", "LACP end: members (s) suspended, no partner heard", "Static end: Po1 up, protocol -"] },
            { tag: "passive", title: "Both ends passive", tone: "warning", points: ["Po down at both ends, members suspended", "show lacp neighbor: no partner on any member", "show lacp internal: SP flags at both ends"] },
            { tag: "group", title: "A member in the wrong group", tone: "violet", points: ["Works, at half the bandwidth", "Different Oper Key per member in show lacp neighbor", "One member (s) at one end, in Po2 at the other"] },
            { tag: "silent", title: "A silent member failure, slow rate", tone: "ip", points: ["Some flows lost for ~90 s, link LEDs green", "Then the member leaves the port-channel (EC-5-UNBUNDLE / LACPD_TIMEOUT)", "Fix: the fast rate at both ends"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="lcd-workflow" eyebrow="Troubleshooting" title="Investigation workflow: read both ends, member by member" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What fails: everything across the uplink, or only some flows?", look: "Everything: the bundle isn't up at all. Some flows: one member is broken but still in the bundle (a silent failure)." },
            { question: "Is every member bundled at BOTH ends?", look: "show etherchannel summary on both switches: (P) vs (s). Junos: Collecting distributing vs Attached." },
            { question: "Do both ends run LACP, and is at least one active?", look: "Protocol LACP vs - (static) in the summary; show lacp internal flags SA/SP." },
            { question: "Does every member lead to the same partner group?", look: "show lacp neighbor: Oper Key per member. One different key means one member is in the wrong group on the far switch." },
            { question: "What does spanning tree see, and is any member failing silently?", look: "show spanning-tree: Po1 as one port, or separate ports with one blocked (no bundle). Link up but flows lost: compare member counters and check the LACP rate." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lcd-faults" eyebrow="Troubleshooting" title="Five faults, from evidence to proof" tone="danger">
        <FaultWalks />
      </GuideSection>

      <GuideSection id="lcd-prove" eyebrow="Troubleshooting" title="Prove the repair with fresh traffic" tone="success">
        <ChecklistCard
          tone="success"
          title="The proof, every time"
          mark="✓"
          items={[
            "Repeat the exact test that failed, and see it succeed",
            "Both ends show the bundle up with every member bundled: Po1(SU) with (P) members · Collecting distributing",
            "Every member sees the same partner system and key",
            "Several flows use at least two members, and every ping comes back",
            "Fail a member (unplug it, or a silent failure with the fast rate): the flows move and keep working",
          ]}
        />
        <p>The lab&apos;s tickets check exactly this: a ticket only closes when the bundle is right <em>and</em> a fresh run of the user&apos;s test succeeds.</p>
      </GuideSection>

      <GuideSection id="lcd-minlinks" eyebrow="Beyond this lesson" title="Minimum links and the hash" tone="warning">
        <FlowSteps
          steps={[
            { title: "Minimum links", body: <>A bundle can be required to have at least N members up (Cisco <Mono>port-channel min-links 2</Mono> · Junos <Mono>set interfaces ae0 aggregated-ether-options minimum-links 2</Mono>). Below that the whole bundle goes down, so routing or spanning tree moves traffic to a path with enough capacity. The lab configures no minimum, so Po1 stays up on one member.</>, tone: "warning" },
            { title: "Choosing the hash inputs", body: <>Platforms let you pick which fields are hashed: MACs, IPs, ports (Cisco <Mono>port-channel load-balance src-dst-ip</Mono> · Junos EX <Mono>forwarding-options enhanced-hash-key</Mono>). Few big flows between the same two hosts hash to the same member whatever you choose.</>, tone: "cyan" },
          ]}
        />
      </GuideSection>

      <GuideSection id="lcd-mlag" eyebrow="Beyond this lesson" title="Bundles across two switches" tone="violet">
        <p>Standard LACP bundles links between exactly two systems. To survive the loss of a whole switch, vendors let two switches present one LACP system identity to the other side: Cisco vPC or StackWise, Juniper Virtual Chassis or MC-LAG. The far end sees one partner and one bundle; the two switches synchronize between themselves. The LACP on the wire is the same as in this lesson.</p>
      </GuideSection>

      <GuideSection id="lcd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "Two cables between two switches double the bandwidth.", correction: "Not without a bundle: spanning tree blocks one. Bundled, they double the total capacity across many flows." },
            { myth: "One transfer goes twice as fast over a two-member bundle.", correction: "One flow stays on one member, so its frames arrive in order. Its speed is one member's speed." },
            { myth: "Both switches must use the same key.", correction: "The key only groups one switch's own ports. SW1 can use 10 and SW2 20." },
            { myth: "Passive is the safe default on both ends.", correction: "Passive only answers. Two passive ends never start, and the bundle never forms." },
            { myth: "Link up means the member carries traffic.", correction: "A member carries traffic only when it is Distributing, after both ends agreed. A silently failed member can also look up while carrying nothing." },
            { myth: "LACP replaces spanning tree.", correction: "LACP bundles links between the same two switches. Loops through other switches still need spanning tree." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lcd-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="lcd-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: "Why does bundling the two cables stop spanning tree from blocking one of them?", a: "Spanning tree runs on the logical port Po1 / ae0 and never sees the member cables. To it there is one link between SW1 and SW2, so there is no loop to break." },
            { q: "Why is ge-0/0/24 suspended when it sits in channel-group 2 on SW2?", a: "SW1 hears different partner keys on its two members (1 and 2). Members with different partner groups can't share one aggregator, so SW1 leaves one out." },
            { q: "Why does a static bundle never notice a silent member failure?", a: "Without LACPDUs there is nothing whose absence could be noticed. The link stays up, so the static bundle keeps hashing flows onto the dead member." },
            { q: "Why do HOST-A → HOST-B and HOST-A → HOST-C use different cables?", a: "They are different flows, and the hash of their addresses maps them to different members. Each stays on its member, so both cables carry traffic." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lcd-practice" eyebrow="Practice" title="Practice in the LACP Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={[
            "Prove both members carry traffic, and build a three-member bundle with the spare cable",
            "Catch the LACP conversation in a capture, and run one side passive",
            "Lose a member without losing a ping, and survive a silent failure within seconds",
            "Solve five tickets from evidence, on Cisco IOS or Junos, and prove each repair",
          ]}
        />
        <PresentationBridge>See the bundle form, flows take different members, and a silent failure in the LACP presentation.</PresentationBridge>
        <LabBridge />
      </GuideSection>
    </div>
  );
}
