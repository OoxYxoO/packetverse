import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, FailureSignatures, FieldTable, FlowSteps, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CliPair, CliPanel, FailureWalk, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { BPDU_DST, LINK_COST } from "@/lib/sim-engine/scenarios/stpRstp";
import { stApply, stTicket, stTicketState, stWarm, type StState, type StSw, type StTicketId } from "@/lib/sim-engine/scenarios/stpNet";
import { candOfSw, stSwitchSets, type StCliApi } from "./stp-lab/stCli";
import { LoopGuardSection } from "./MoreGuards";
import { ClaimsDiagram, DataPathDiagram, DesignatedDiagram, ElectionDiagram, FailoverDiagram, IncidentDiagram, LoopDiagram, RepairDiagram, RootPortDiagram, TreeDiagram } from "./LessonGuideContent";

/**
 * STP & RSTP DEEP DIVE — the complete study course, taught on the lesson's own triangle (SW1, SW2, SW3). Every CLI
 * sample is produced by running the STP Lab's model and its real Cisco/Junos command sets.
 * Progression: Foundation → The election → Convergence → Protection → Operations → Troubleshooting → Beyond → Master it.
 */

// Real CLI output, run by the lab's own command sets against the lab's model: the guide shows exactly what the lab shows.
function cliApi(s: StState): StCliApi {
  const exec = { kind: "exec" } as const;
  return { view: s, act: () => s, ios: { SW1: exec, SW2: exec, SW3: exec }, setIos: () => undefined, junosEdit: { SW1: false, SW2: false, SW3: false }, setJunosEdit: () => undefined, cand: { SW1: candOfSw(s.cfg.sw.SW1), SW2: candOfSw(s.cfg.sw.SW2), SW3: candOfSw(s.cfg.sw.SW3) }, setCand: () => undefined };
}
const cli = (s: StState, sw: StSw, vendor: CliVendor, command: string) => runGuideCli(stSwitchSets(cliApi(s), sw)[vendor]!, command);
/** A ticket's network after its test ran: the state the student investigates. */
const ticketState = (id: StTicketId) => stTicket(id).repro.reduce((acc, a) => stApply(acc, a), stTicketState(id, 1));
const WARM = stWarm();
function BridgeIdDiagram() {
  return (
    <DiagramSvg h={150} label="A Bridge ID is 8 bytes: a 2-byte priority followed by the bridge's 6-byte MAC address; lower is better, priority compared first">
      <DFieldRow x={60} y={30} h={46} fields={[{ label: "Priority", sub: "2 bytes · e.g. 24576", w: 170, color: D.violet, strong: true }, { label: "Bridge MAC", sub: "6 bytes · e.g. 00:00:5E:00:53:01", w: 350, color: D.eth }]} />
      <text x={60} y={104} fill={D.text} fontSize={10.5} fontWeight={700}>
        Compared as one number: the priority dominates; the MAC only decides between equal priorities.
      </text>
      <text x={60} y={124} fill={D.muted} fontSize={10}>
        Cisco PVST+ folds the VLAN number into the priority field (system ID extension):
      </text>
      <text x={60} y={140} fill={D.muted} fontSize={10}>
        24576 for VLAN 1 is shown as 24577. The comparison rule is the same.
      </text>
    </DiagramSvg>
  );
}

function BpduDiagram() {
  return (
    <DiagramSvg h={190} label={`RST BPDU frame: IEEE 802.3 header to ${BPDU_DST} with length, LLC DSAP 0x42 SSAP 0x42 control 0x03, then protocol id, version 2, type 0x02, flags, Root ID, Root Path Cost, Bridge ID, Port ID and timers; no IP header`}>
      <DFieldRow x={20} y={16} h={42} fields={[{ label: "Dst MAC", sub: BPDU_DST, w: 150, color: D.eth, strong: true }, { label: "Src MAC", sub: "sending port", w: 110, color: D.eth }, { label: "Length", sub: "39", w: 60, color: D.eth }, { label: "LLC", sub: "42 · 42 · 03", w: 100, color: D.violet }, { label: "RST BPDU", sub: "36 bytes", w: 180, color: D.cyan, strong: true }]} />
      <DFieldRow x={20} y={86} h={42} fields={[{ label: "Ver 2", sub: "type 0x02", w: 90, color: D.cyan }, { label: "Flags", sub: "role · state · P/A", w: 110, color: D.cyan }, { label: "Root ID", w: 110, color: D.cyan, strong: true }, { label: "Root Cost", w: 90, color: D.cyan, strong: true }, { label: "Bridge ID", w: 110, color: D.cyan, strong: true }, { label: "Port ID", w: 90, color: D.cyan }]} />
      <text x={20} y={156} fill={D.text} fontSize={10.5} fontWeight={700}>
        Reserved bridge-group address: a bridge consumes it; it is never forwarded as customer traffic.
      </text>
      <text x={20} y={176} fill={D.muted} fontSize={10}>
        No IPv4, UDP or TCP anywhere — BPDUs are Layer-2, link-local control frames.
      </text>
    </DiagramSvg>
  );
}

function VectorDiagram() {
  const steps = [
    { t: "Root ID", n: "1st" },
    { t: "Root Path Cost", n: "2nd" },
    { t: "sender Bridge ID", n: "3rd" },
    { t: "sender Port ID", n: "4th" },
    { t: "receiving Port ID", n: "5th" },
  ];
  return (
    <DiagramSvg h={120} label="Priority vector comparison order: Root ID, then Root Path Cost, then sender Bridge ID, then sender Port ID, then receiving Port ID; lower wins at the first difference">
      {steps.map((x, i) => (
        <g key={x.t}>
          <DNode x={64 + i * 128} y={46} label={x.t} sub={x.n} accent={i < 2 ? D.violet : D.cyan} w={120} h={44} />
          {i < steps.length - 1 && <DArrow x1={125 + i * 128} y1={46} x2={131 + i * 128} y2={46} color={D.muted} width={1.4} />}
        </g>
      ))}
      <text x={320} y={100} textAnchor="middle" fill={D.muted} fontSize={10}>
        Compare left to right; the first field that differs decides, and lower is better.
      </text>
    </DiagramSvg>
  );
}

function RolesDiagram() {
  return (
    <DiagramSvg h={190} label="RSTP port roles: Root, Designated, Alternate, Backup, Disabled, with their usual states">
      <DTable
        x={20}
        y={8}
        title="RSTP port roles"
        cols={[
          { label: "ROLE", w: 110 },
          { label: "MEANING", w: 350 },
          { label: "USUAL STATE", w: 140 },
        ]}
        rows={[
          ["Root", "a non-root bridge's best path toward the root", "Forwarding"],
          ["Designated", "the port that forwards for its segment", "Forwarding"],
          ["Alternate", "backup path to the root via another bridge", "Discarding"],
          ["Backup", "backup for a segment this bridge already serves", "Discarding"],
          ["Disabled", "not operational (e.g. link down)", "Discarding"],
        ]}
        highlight={{ row: 2, color: D.warning }}
        rowH={24}
      />
    </DiagramSvg>
  );
}

function StatesDiagram() {
  return (
    <DiagramSvg h={170} label="Classic 802.1D STP states Blocking, Listening, Learning, Forwarding compared with RSTP states Discarding, Learning, Forwarding">
      <DTable
        x={20}
        y={8}
        title="Classic STP vs RSTP port states"
        cols={[
          { label: "CLASSIC 802.1D STP", w: 200 },
          { label: "RSTP", w: 160 },
          { label: "LEARNS MACs?", w: 120 },
          { label: "FORWARDS DATA?", w: 120 },
        ]}
        rows={[
          ["Blocking", "Discarding", "no", "no"],
          ["Listening", "Discarding", "no", "no"],
          ["Learning", "Learning", "yes", "no"],
          ["Forwarding", "Forwarding", "yes", "yes"],
        ]}
        rowH={24}
      />
      <text x={20} y={160} fill={D.muted} fontSize={10}>
        RSTP folds Blocking and Listening into one Discarding state; this lesson uses the RSTP model throughout.
      </text>
    </DiagramSvg>
  );
}

function SyncDiagram() {
  return (
    <DiagramSvg h={200} label="Proposal and agreement on a point-to-point link: the upstream Designated port proposes; the downstream bridge synchronizes its other ports and agrees; the port moves to Forwarding without waiting for timers">
      <DNode x={120} y={40} label="Upstream bridge" sub="Designated · Discarding" accent={D.violet} w={170} />
      <DNode x={520} y={40} label="Downstream bridge" sub="Root Port" accent={D.cyan} w={170} />
      <DArrow x1={206} y1={80} x2={434} y2={80} color={D.violet} label="1 · BPDU with Proposal flag" />
      <DArrow x1={434} y1={120} x2={206} y2={120} color={D.success} label="3 · BPDU with Agreement flag" />
      <text x={520} y={96} textAnchor="middle" fill={D.warning} fontSize={10} fontWeight={700}>
        2 · sync its other ports
      </text>
      <text x={520} y={110} textAnchor="middle" fill={D.warning} fontSize={9.5}>
        (non-edge ports held Discarding)
      </text>
      <text x={120} y={160} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        4 · Designated → Forwarding
      </text>
      <text x={20} y={188} fill={D.muted} fontSize={10}>
        Concept only: the lesson describes this handshake but does not step through every state-machine transition.
      </text>
    </DiagramSvg>
  );
}

function TcDiagram() {
  return (
    <DiagramSvg h={170} label="Topology change: a non-edge port moving to Forwarding (or a root path change) triggers topology-change BPDUs; bridges flush dynamic MAC entries learned on non-edge ports and relearn over the new tree">
      <DNode x={100} y={50} label="Tree changes" sub="port → Forwarding" accent={D.warning} w={150} />
      <DArrow x1={176} y1={50} x2={254} y2={50} color={D.muted} />
      <DNode x={330} y={50} label="TC flag in BPDUs" sub="sent across the tree" accent={D.violet} w={150} />
      <DArrow x1={406} y1={50} x2={474} y2={50} color={D.muted} />
      <DNode x={550} y={50} label="Flush" sub="non-edge MAC entries" accent={D.cyan} w={140} />
      <text x={20} y={110} fill={D.text} fontSize={10.5} fontWeight={700}>
        Why flush? Old entries may point along paths that no longer forward.
      </text>
      <text x={20} y={130} fill={D.muted} fontSize={10}>
        After the flush, traffic floods briefly as unknown unicast, and entries are relearned over the new tree.
      </text>
      <text x={20} y={150} fill={D.muted} fontSize={10}>
        Entries on edge ports (hosts) are not flushed: edge ports don&apos;t cause topology changes.
      </text>
    </DiagramSvg>
  );
}

function EdgeDiagram() {
  return (
    <DiagramSvg h={150} label="Edge port concept: a host-facing port expected never to lead to another bridge goes straight to Forwarding; if a BPDU arrives there, a standard RSTP port stops treating itself as edge and runs the normal role selection">
      <DNode x={110} y={50} label="Edge port" sub="host · Forwarding at once" accent={D.success} w={170} />
      <DArrow x1={197} y1={50} x2={317} y2={50} color={D.warning} label="BPDU arrives" />
      <DNode x={420} y={50} label="No longer edge" sub="normal RSTP roles" accent={D.violet} w={190} />
      <text x={20} y={110} fill={D.text} fontSize={10.5} fontWeight={700}>
        Edge status speeds up host ports; it is not a way to switch loop protection off.
      </text>
      <text x={20} y={130} fill={D.muted} fontSize={10}>
        The lesson&apos;s incident disabled RSTP on an inter-switch port — a different (and unsafe) change.
      </text>
    </DiagramSvg>
  );
}

/** What a healthy tree looks like, read from the devices — the state every later section refers to. */
function NormalState() {
  const sw3 = cli(WARM, "SW3", "cisco", "show spanning-tree");
  const det = cli(WARM, "SW3", "cisco", "show spanning-tree interface Gi1/0/2 detail");
  return (
    <div className="space-y-5">
      <p>
        Before anything breaks, learn what a healthy tree looks like. This is the lab&apos;s triangle after a normal morning: RSTP has converged and the hosts have pinged each other. Below are the four verification questions, asked on the real switches, with the state described above in the answers. Every output is exactly what the STP Lab prints. Keep this page in mind: in the five faults below you will compare broken output with it.
      </p>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">1 · Who is the root, and does everyone agree?</h4>
        <CliPair cisco={cli(WARM, "SW2", "cisco", "show spanning-tree root")} junos={cli(WARM, "SW1", "juniper", "show spanning-tree bridge")} ciscoCaption="SW2 · Cisco IOS" junosCaption="SW1 · Junos" />
        <p className="text-sm text-pv-text-muted">
          Every switch names the same root: SW1, MAC …53:01, priority 24576. SW1 holds the lowest priority on purpose, so the core switch is root rather than whichever MAC happens to be lowest. Cisco prints <Mono>24577</Mono> because Rapid PVST+ adds the VLAN number (sys-id-ext 1) to the priority. On SW1 the Junos Root ID and Bridge ID are identical, and there is no root port: that is what being the root looks like.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">2 · Which port leads each switch to the root, and which one blocks?</h4>
        <CliPair cisco={sw3} junos={cli(WARM, "SW3", "juniper", "show spanning-tree interface")} ciscoCaption="SW3 · Cisco IOS" junosCaption="SW3 · Junos" />
        <p className="text-sm text-pv-text-muted">
          SW3 reaches the root directly: Root Port Gi1/0/1 (ge-0/0/1), cost 20000. Its cross-link to SW2, Gi1/0/2, is <Mono>Altn BLK</Mono> (Junos <Mono>BLK ALT</Mono>): the link is up, but it carries no customer frames. The host port Gi1/0/10 is <Mono>P2p Edge</Mono>, so it forwards without taking part in the loop decision. On SW1 and SW2 every port forwards. Exactly one port blocks in the triangle, which is exactly one per loop.
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="text-sm font-bold text-pv-text">3 · Why that port, and not SW2&apos;s end?</h4>
        <CliPanel run={{ ...det, output: pickLines(det.output, /Port 2|Designated|path cost/) }} />
        <p className="text-sm text-pv-text-muted">
          Both ends of SW2–SW3 offer the root at cost 20000. The tie goes to the lower Bridge ID: SW2 (…53:02) beats SW3 (…53:03), so SW2&apos;s end is Designated and SW3&apos;s end is Alternate. The detail output names the winner as the <em>designated bridge</em>: priority 32768, address 0000.5e00.5302.
        </p>
      </div>
      <Callout tone="success" title="And the traffic proves it" icon="✓">
        HOST-C → HOST-A goes SW3 → SW1 over the direct link. HOST-C → HOST-B goes SW3 → SW1 → SW2, never over the blocked cross-link. One ARP broadcast reaches each host exactly once. Press <strong>Send a Hello (BPDUs)</strong> in the lab: Designated ports send BPDUs, Root and Alternate ports receive them, including the blocked one.
      </Callout>
    </div>
  );
}

/** The five faults the lab can break, each walked from normal state to proof. */
function FaultWalks() {
  const loop = ticketState("loop");
  const rogue = ticketState("rogue");
  const cost = ticketState("cost");
  const edge = ticketState("edge");
  const legacy = ticketState("legacy");
  const table = /^(Interface|-{5}|Gi1)/;
  const loopTree = cli(loop, "SW3", "cisco", "show spanning-tree");
  const loopLog = cli(loop, "SW1", "cisco", "show logging");
  const rogueTree = cli(rogue, "SW3", "cisco", "show spanning-tree");
  const costTree = cli(cost, "SW3", "cisco", "show spanning-tree");
  const edgeTree = cli(edge, "SW2", "cisco", "show spanning-tree");
  const legacyTree = cli(legacy, "SW3", "cisco", "show spanning-tree");
  const legacyBridge = cli(legacy, "SW3", "juniper", "show spanning-tree bridge");
  return (
    <div className="space-y-4">
      <p>These are the five faults of the lab&apos;s tickets. Each one starts from the healthy evidence above and changes one thing. Read the evidence first and compare it with the healthy output, because the difference is the clue. Then see how the investigation questions lead to the cause, how to repair it on both vendors, and what proves the repair.</p>
      <FailureWalk
        title="1 · A switch port taken out of spanning tree"
        normal={<>SW3&apos;s cross-link port Gi1/0/2 (ge-0/0/2) is Alternate/Blocking, so the triangle has one blocked port and no loop.</>}
        change={<>During maintenance, spanning tree is disabled on that port: Junos <Mono>set protocols rstp interface ge-0/0/2 disable</Mono>, Cisco <Mono>spanning-tree bpdufilter enable</Mono>. The port no longer sends or processes BPDUs, so nothing can tell it to block.</>}
        evidence={
          <>
            <p>The whole LAN crawls, link lights flash nonstop, and every switch logs MAC moves. One broadcast now circulates both ways round the triangle (Ethernet has no TTL). On SW3 nothing blocks any more, and SW1 sees HOST-A&apos;s MAC jumping between ports:</p>
            <CliPanel run={{ ...loopTree, output: pickLines(loopTree.output, table) }} />
            <CliPanel run={{ ...loopLog, output: loopLog.output.split("\n").slice(0, 5).join("\n") }} />
            <DiagramFrame caption="RSTP can only protect ports that participate in it.">
              <IncidentDiagram />
            </DiagramFrame>
          </>
        }
        next={<>A loop with all links up means some port is outside spanning tree. Count the blocked ports (<Mono>show spanning-tree blockedports</Mono>: zero) and look for the port that ignores BPDUs: <Mono>Bpdu filter is enabled</Mono> in <Mono>show spanning-tree interface Gi1/0/2 detail</Mono>, or <Mono>interface ge-0/0/2 disable</Mono> under <Mono>show configuration protocols rstp</Mono>. Clearing MAC tables, unplugging a host or changing a MAC doesn&apos;t put the port back under spanning tree.</>}
        fix={<>On SW3: Cisco <Mono>interface Gi1/0/2</Mono>, <Mono>no spanning-tree bpdufilter</Mono> · Junos <Mono>delete protocols rstp interface ge-0/0/2 disable</Mono>, then <Mono>commit</Mono>.</>}
        proof={
          <>
            <p>Gi1/0/2 is Alternate/Blocking again, one new ARP reaches each host once, and no new MAC-flap messages appear.</p>
            <DiagramFrame caption="The same tree as before the incident.">
              <RepairDiagram />
            </DiagramFrame>
          </>
        }
      />
      <FailureWalk
        title="2 · A stray switch becomes the root"
        normal={<>Every switch names SW1 (24576 · …53:01) as root. SW3&apos;s spare port Gi1/0/11 (ge-0/0/11) is an edge port with nothing plugged in.</>}
        change={<>A contractor plugs a small switch into that spare port. Its priority is 4096, lower than SW1&apos;s, and the port has no BPDU guard, so spanning tree accepts it as the new root.</>}
        evidence={
          <>
            <p>Nothing is down, but traffic between floors 1 and 2 detours through SW3 toward the new root. Every switch now names a root you don&apos;t know (…53:99, priority 4096). SW2&apos;s Root Port has moved to the cross-link, and on SW3 the spare port has become the Root Port:</p>
            <CliPanel run={cli(rogue, "SW2", "cisco", "show spanning-tree root")} />
            <CliPanel run={{ ...rogueTree, output: pickLines(rogueTree.output, table) }} />
          </>
        }
        next={<>An unknown Root ID means a bridge you didn&apos;t design is winning the election. Follow each switch&apos;s Root Port toward it until one points out of your network: here SW3 Gi1/0/11. CDP and LLDP don&apos;t list it (a cheap switch may not run them). The fix is a protection, not a priority race.</>}
        fix={<>Unplug the small switch and protect SW3&apos;s spare port. BPDU guard: Cisco <Mono>interface Gi1/0/11</Mono>, <Mono>spanning-tree bpduguard enable</Mono> · Junos <Mono>set protocols layer2-control bpdu-block interface ge-0/0/11</Mono>. Or root guard: Cisco <Mono>spanning-tree guard root</Mono> · Junos <Mono>set protocols rstp interface ge-0/0/11 no-root-port</Mono>. Commit on Junos.</>}
        proof={<>Every switch names SW1 as root again. With BPDU guard the spare port is <Mono>err-disabled</Mono> (<Mono>show interfaces status</Mono>), and with root guard it is root-inconsistent. HOST-A → HOST-B goes SW1 → SW2 directly.</>}
      />
      <FailureWalk
        title="3 · A changed port cost moves the Root Port"
        normal={<>SW3&apos;s Root Port is its direct link Gi1/0/1, root cost 20000.</>}
        change={<>A cost &quot;tuning&quot; on SW3 sets Gi1/0/1&apos;s cost to 200000. The root doesn&apos;t change: only SW3&apos;s view of the paths toward it.</>}
        evidence={
          <>
            <p>Floor 3&apos;s uplink sits idle and SW2 carries everything for floor 3. SW3 now reaches the root through SW2 (cost 20000 + 20000 = 40000), and its direct link is the blocked one:</p>
            <CliPanel run={{ ...costTree, output: pickLines(costTree.output, /Cost|Port {8}|^(Interface|-{5}|Gi1)/) }} />
          </>
        }
        next={<>The root is right but a Root Port is wrong: compare the costs. The cost is added on the port where the BPDU <strong>arrives</strong>, so read the receiving switch&apos;s own port costs: the <Mono>Cost</Mono> column of <Mono>show spanning-tree</Mono>, or <Mono>cost</Mono> under <Mono>show configuration protocols rstp</Mono>.</>}
        fix={<>On SW3, back to the default cost: Cisco <Mono>interface Gi1/0/1</Mono>, <Mono>no spanning-tree cost</Mono> · Junos <Mono>delete protocols rstp interface ge-0/0/1 cost</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>SW3&apos;s Root Port is Gi1/0/1 again, the cross-link is Alternate again, and HOST-C → HOST-A goes SW3 → SW1.</>}
      />
      <FailureWalk
        title="4 · A host port that is not an edge port"
        normal={<>SW2&apos;s host port Gi1/0/10 (ge-0/0/10) is <Mono>P2p Edge</Mono>: it forwards as soon as HOST-B&apos;s link comes up.</>}
        change={<>The edge setting is removed from that port (Cisco <Mono>spanning-tree portfast</Mono>, Junos <Mono>edge</Mono> under the rstp interface).</>}
        evidence={
          <>
            <p>Every time HOST-B&apos;s cable is reseated or the PC reboots, it has no network for about 30 seconds and its DHCP times out. Right after link-up the port is Designated but not forwarding, and its Type has lost <Mono>Edge</Mono>:</p>
            <CliPanel run={{ ...edgeTree, output: pickLines(edgeTree.output, table) }} />
          </>
        }
        next={<>RSTP moves a Designated port to forwarding with a proposal/agreement handshake. A PC never answers the proposal, so a non-edge host port falls back to 2 × forward delay: 15 s discarding, 15 s learning. Check the <Mono>Type</Mono> column, or the port&apos;s <Mono>edge</Mono> statement in <Mono>show configuration protocols rstp</Mono>.</>}
        fix={<>On SW2: Cisco <Mono>interface Gi1/0/10</Mono>, <Mono>spanning-tree portfast</Mono> · Junos <Mono>set protocols rstp interface ge-0/0/10 edge</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>Reseat the cable again: the port is FWD at once and HOST-B&apos;s first ping works.</>}
      />
      <FailureWalk
        title="5 · One switch runs legacy 802.1D STP"
        normal={<>All three switches run RSTP. When a link fails, SW3&apos;s Alternate port becomes its Root Port at once.</>}
        change={<>SW3 is switched to legacy STP (Cisco <Mono>spanning-tree mode pvst</Mono>, Junos <Mono>protocols stp</Mono>). Legacy STP has no Alternate role and no handshake: only timers.</>}
        evidence={
          <>
            <p>When the SW1↔SW3 cable is unplugged, floor 3 loses the network for 30 seconds or more, while a failure elsewhere is a blip. SW3 runs <Mono>ieee</Mono> (802.1D), and its new Root Port is still <Mono>LIS</Mono> (Listening):</p>
            <CliPanel run={{ ...legacyTree, output: pickLines(legacyTree.output, /protocol|^(Interface|-{5}|Gi1)/) }} />
            <CliPanel run={{ ...legacyBridge, output: pickLines(legacyBridge.output, /Enabled protocol|Root port|topology/) }} />
          </>
        }
        next={<>A long outage after a link failure on one switch only: check the protocol (<Mono>show spanning-tree</Mono> first line · <Mono>Enabled protocol</Mono>). Listening and Learning states exist only in legacy STP: 15 s each before forwarding, plus 20 s max age when the failure is indirect.</>}
        fix={<>On SW3: Cisco <Mono>spanning-tree mode rapid-pvst</Mono> · Junos <Mono>delete protocols stp</Mono>, <Mono>set protocols rstp</Mono>, then <Mono>commit</Mono>.</>}
        proof={<>SW3 runs RSTP again. Unplug the cable again: HOST-C&apos;s first ping works.</>}
      />
    </div>
  );
}

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the STP Lab" onPractice={openLab}>
      Same triangle, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const G = { foundation: "Foundation", elect: "The election", conv: "Convergence", protect: "Protection", ops: "Operations", trouble: "Troubleshooting", beyond: "Beyond this lesson", master: "Master it" };

export const STP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "std-why", label: "Why spanning tree exists", group: G.foundation },
  { id: "std-idea", label: "A tree over a mesh", group: G.foundation },
  { id: "std-bpdu", label: "BPDUs: how switches talk", group: G.elect },
  { id: "std-bid", label: "Electing the root", group: G.elect },
  { id: "std-rootport", label: "Root Ports and path cost", group: G.elect },
  { id: "std-designated", label: "Designated and Alternate", group: G.elect },
  { id: "std-roles", label: "Roles and states", group: G.elect },
  { id: "std-rstp", label: "RSTP and legacy STP", group: G.conv },
  { id: "std-sync", label: "Proposal and agreement", group: G.conv },
  { id: "std-edge", label: "Edge ports", group: G.conv },
  { id: "std-tc", label: "Topology change", group: G.conv },
  { id: "std-failover", label: "When a link fails", group: G.conv },
  { id: "std-guards", label: "BPDU guard and root guard", group: G.protect },
  { id: "std-loopguard", label: "Loop Guard and BPDU filter", group: G.protect },
  { id: "std-state", label: "The state each switch keeps", group: G.ops },
  { id: "std-verify", label: "How to verify: four questions", group: G.ops },
  { id: "std-normal", label: "What healthy looks like", group: G.ops },
  { id: "std-signatures", label: "Failure signatures", group: G.trouble },
  { id: "std-workflow", label: "Investigation workflow", group: G.trouble },
  { id: "std-faults", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "std-prove", label: "Prove the repair", group: G.trouble },
  { id: "std-variants", label: "PVST+, MSTP and real designs", group: G.beyond },
  { id: "std-lacp", label: "Spanning tree vs link aggregation", group: G.beyond },
  { id: "std-myths", label: "Common misconceptions", group: G.master },
  { id: "std-quiz", label: "Knowledge check", group: G.master },
  { id: "std-explain", label: "Can you explain it?", group: G.master },
  { id: "std-practice", label: "Practice in the STP Lab", group: G.master },
];

const QUIZ: KnowledgeQuestion[] = [
  {
    id: "q-root",
    prompt: "SW1 has priority 24576, SW2 and SW3 have 32768. SW3 has the lowest MAC of the three. Which switch is root?",
    options: [
      { id: "a", label: "SW3, because its MAC is lowest" },
      { id: "b", label: "SW1, because priority is compared first" },
      { id: "c", label: "Whichever switch booted first" },
      { id: "d", label: "SW2, the middle MAC" },
    ],
    correctId: "b",
    explanation: "The Bridge ID is priority followed by MAC, compared as one value. The priority dominates; the MAC only breaks ties between equal priorities.",
  },
  {
    id: "q-cost",
    prompt: `SW3 hears the root directly over a 1 Gb/s link, and through SW2 over two 1 Gb/s links. What is the root path cost through SW2?`,
    options: [
      { id: "a", label: String(LINK_COST) },
      { id: "b", label: String(LINK_COST * 2) },
      { id: "c", label: "0" },
      { id: "d", label: String(LINK_COST * 3) },
    ],
    correctId: "b",
    explanation: `SW2 advertises cost ${LINK_COST} (its own receiving port toward SW1). SW3 adds the cost of the port where that BPDU arrives: ${LINK_COST} + ${LINK_COST} = ${LINK_COST * 2}. The direct path costs ${LINK_COST}, so the direct port is SW3's Root Port.`,
  },
  {
    id: "q-designated",
    prompt: "On the SW2–SW3 link both ends advertise the root at the same cost. Which end becomes Alternate?",
    options: [
      { id: "a", label: "SW2's end, because SW2 has the lower MAC" },
      { id: "b", label: "SW3's end, because SW3 has the higher Bridge ID" },
      { id: "c", label: "Both ends block" },
      { id: "d", label: "Neither: both forward" },
    ],
    correctId: "b",
    explanation: "With Root ID and cost tied, the lower sender Bridge ID wins the Designated role. SW2 (…:02) beats SW3 (…:03), so SW3's end is neither Root nor Designated: Alternate, Discarding.",
  },
  {
    id: "q-discard",
    prompt: "What does SW3's Alternate port do while it is Discarding?",
    options: [
      { id: "a", label: "Nothing: the link is down" },
      { id: "b", label: "Forwards customer frames but does not learn" },
      { id: "c", label: "Receives and processes BPDUs, but neither forwards nor learns customer frames" },
      { id: "d", label: "Sends BPDUs but drops incoming ones" },
    ],
    correctId: "c",
    explanation: "The link stays up and the port keeps hearing SW2's BPDUs. That is how it stays ready to become Root Port the moment the direct path fails.",
  },
  {
    id: "q-edge",
    prompt: "A PC's port is not configured as an edge port. What happens every time the PC reboots under RSTP?",
    options: [
      { id: "a", label: "Nothing different: RSTP is rapid everywhere" },
      { id: "b", label: "The port waits 2 × forward delay (about 30 s) before forwarding" },
      { id: "c", label: "The port is err-disabled" },
      { id: "d", label: "The PC becomes root" },
    ],
    correctId: "b",
    explanation: "RSTP's fast transition needs an agreement from the other side. A PC never answers the proposal, so the port falls back to the timers: 15 s discarding and 15 s learning.",
  },
  {
    id: "q-loop",
    prompt: "All three links are up and no port blocks anywhere. What does that tell you?",
    options: [
      { id: "a", label: "The tree is healthy" },
      { id: "b", label: "Some port is outside spanning tree, and the triangle is looping" },
      { id: "c", label: "The root has failed" },
      { id: "d", label: "RSTP is in legacy mode" },
    ],
    correctId: "b",
    explanation: "Every physical loop needs one blocked port. None blocking with all links up means a port isn't participating (BPDU filter, or RSTP disabled on it), so broadcasts circulate forever.",
  },
];

export function StpDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="std-why" eyebrow="Foundation" title="Why spanning tree exists" tone="ethernet">
        <p>
          A company cables its three floor switches in a triangle: SW1 to SW2, SW1 to SW3, and SW2 to SW3. Any single cable can fail and every floor still reaches every other floor. But you know from Switching what a second active path does: a switch floods a broadcast out of every port except the one it arrived on, so in a triangle where every port forwards, HOST-A&apos;s ARP request goes round and round. Ethernet frames have no TTL, so nothing ever stops them.
        </p>
        <DiagramFrame caption="Without spanning tree, one broadcast circulates in both directions round the triangle.">
          <LoopDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "A broadcast storm", body: "Copies multiply with every turn until the links are saturated and the switches' CPUs are overwhelmed. The whole LAN crawls.", tone: "danger" },
            { title: "MAC tables flap", body: "The same source MAC arrives from different directions, so switches keep moving it between ports and forward unicast the wrong way.", tone: "warning" },
            { title: "Hosts receive duplicates", body: "Every host gets endless copies of the same frame. Pings show DUP!, applications break.", tone: "violet" },
          ]}
        />
      </GuideSection>

      <GuideSection id="std-idea" eyebrow="Foundation" title="A tree over a mesh" tone="cyan">
        <p>
          Spanning tree keeps every cable physically up and still allows exactly one active path between any two switches. The switches exchange small control messages, <strong>BPDUs</strong>, and compute a tree. In the triangle that means one port, at one end of one cable, refuses to forward customer frames. The cable stays up and that port keeps listening, ready to take over when another cable fails.
        </p>
        <DiagramFrame caption="The loop-free tree: SW1–SW2 and SW1–SW3 forward, SW3's end of SW2–SW3 is Alternate/Discarding, every cable is up.">
          <TreeDiagram />
        </DiagramFrame>
        <Callout tone="ethernet" title="The rule that carries the whole subject">
          The lowest Bridge ID is root. Every other switch keeps exactly one Root Port toward it. On every link one Designated port forwards, and any other port on a loop is held Alternate/Discarding.
        </Callout>
      </GuideSection>

      <GuideSection id="std-bpdu" eyebrow="The election" title="BPDUs: how switches talk" tone="cyan">
        <p>
          Every 2 s (the hello time) each switch sends BPDUs out of its Designated ports to the reserved multicast MAC <Mono>{BPDU_DST}</Mono>: &quot;I believe the root is X, it costs me Y to reach it, and I am Z, sending from port P.&quot; Switches consume BPDUs and never forward them as data. At first, every switch claims to be root itself.
        </p>
        <DiagramFrame caption="Each bridge's first BPDUs name itself as root.">
          <ClaimsDiagram />
        </DiagramFrame>
        <DiagramFrame caption="IEEE 802.3 + LLC + RST BPDU (Protocol Version 2, BPDU Type 0x02).">
          <BpduDiagram />
        </DiagramFrame>
        <p>
          The Flags byte carries the sending port&apos;s role and its Learning/Forwarding state, plus the Proposal, Agreement and topology-change bits. The Port ID is 16 bits: port priority in the top 4 bits (in steps of 16), port number in the low 12, so priority 128 on port 2 is <Mono>0x8002</Mono>. Message Age is a timer, not a metric: the root sends 0, each relaying bridge adds one, and Max Age (20 s) bounds how long the information stays valid.
        </p>
      </GuideSection>

      <GuideSection id="std-bid" eyebrow="The election" title="Electing the root" tone="violet">
        <p>
          The <strong>Bridge ID</strong> is the priority (default 32768, configurable in steps of 4096) followed by the switch&apos;s MAC. The lowest wins. A switch that hears a better root stops claiming and repeats the better one, so within a few hellos every switch names the same root.
        </p>
        <DiagramFrame caption="Priority and MAC, compared as one value.">
          <BridgeIdDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Priority is compared before the MAC.">
          <ElectionDiagram />
        </DiagramFrame>
        <p>SW1 was given 24576 on purpose (Cisco <Mono>spanning-tree vlan 1 priority 24576</Mono> · Junos <Mono>set protocols rstp bridge-priority 24k</Mono>). Left to the defaults, the root would be whichever switch has the lowest MAC, often the oldest switch in the closet.</p>
      </GuideSection>

      <GuideSection id="std-rootport" eyebrow="The election" title="Root Ports and path cost" tone="ip">
        <p>
          Every non-root switch picks one <strong>Root Port</strong>: its cheapest path to the root. The root sends cost 0; each switch adds the cost of the port where the BPDU <em>arrives</em>, and advertises the total onward. SW3 hears the root directly at 0 + {LINK_COST}, and through SW2 at {LINK_COST} + {LINK_COST}, so its direct port wins.
        </p>
        <DiagramFrame caption="Root Ports face the root; the root itself has none.">
          <RootPortDiagram />
        </DiagramFrame>
        <FieldTable
          title="Default port costs (IEEE 802.1t long scale, used in the lab)"
          columns={["Link speed", "Cost"]}
          rows={[
            ["10 Mb/s", "2 000 000"],
            ["100 Mb/s", "200 000"],
            ["1 Gb/s", "20 000"],
            ["10 Gb/s", "2 000"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">Some platforms still default to the older short scale (1 Gb/s = 4); Cisco selects the scale with <Mono>spanning-tree pathcost method long</Mono>. Use one scale throughout a network, or costs stop meaning the same thing.</p>
      </GuideSection>

      <GuideSection id="std-designated" eyebrow="The election" title="Designated and Alternate ports" tone="warning">
        <p>
          On every link, the end that sends the better offer is <strong>Designated</strong> and forwards onto that link. Offers are compared as <em>priority vectors</em>, field by field, and the first difference decides. On SW2–SW3 both ends offer the root at cost {LINK_COST}, so the sender Bridge ID decides: SW2 wins. SW3&apos;s end is neither Root nor Designated, so it becomes <strong>Alternate</strong> and discards data in both directions, while still hearing SW2&apos;s BPDUs.
        </p>
        <DiagramFrame caption="The same ordered comparison chooses the root, Root Ports and Designated ports.">
          <VectorDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Priority vectors on the SW2–SW3 link.">
          <DesignatedDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="std-roles" eyebrow="The election" title="Roles and states" tone="cyan">
        <p>A port&apos;s <strong>role</strong> says what it is for; its <strong>state</strong> says what it does with customer frames right now.</p>
        <DiagramFrame caption="Role says what a port is for; state says what it does with customer data right now.">
          <RolesDiagram />
        </DiagramFrame>
        <DiagramFrame caption="Different names, one idea: data forwards only in Forwarding.">
          <StatesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="std-rstp" eyebrow="Convergence" title="RSTP and legacy STP" tone="success">
        <p>The election is the same in both protocols. What differs is how fast a port may start forwarding:</p>
        <CompareCards
          items={[
            { title: "RSTP (802.1w)", tone: "success", tag: "rapid", points: ["An Alternate port becomes Root Port at once", "A Designated port toward an RSTP switch forwards after a quick proposal/agreement", "Port states: Discarding, Learning, Forwarding", "Cisco: spanning-tree mode rapid-pvst · Junos: protocols rstp"] },
            { title: "Legacy STP (802.1D)", tone: "warning", tag: "timers", points: ["No Alternate role, no handshake", "Listening 15 s + Learning 15 s before forwarding", "+20 s max age when the failure is indirect", "Cisco: spanning-tree mode pvst · Junos: protocols stp"] },
          ]}
        />
        <p>An RSTP switch talks legacy STP to a legacy neighbor, so one old switch slows convergence wherever it takes part.</p>
      </GuideSection>

      <GuideSection id="std-sync" eyebrow="Convergence" title="Proposal and agreement" tone="success">
        <DiagramFrame caption="Rapid synchronization on point-to-point links.">
          <SyncDiagram />
        </DiagramFrame>
        <p>The handshake is why RSTP is fast on links between switches, and why it can&apos;t be fast toward a PC: a PC never agrees. That is the job of edge ports.</p>
      </GuideSection>

      <GuideSection id="std-edge" eyebrow="Convergence" title="Edge ports" tone="ip">
        <DiagramFrame caption="A convenience for host ports, not a loop-protection switch.">
          <EdgeDiagram />
        </DiagramFrame>
        <p>
          A host port that is <em>not</em> edge waits 2 × forward delay (30 s) every time its link comes up, long enough for DHCP to time out. Configure host ports as edge: Cisco <Mono>spanning-tree portfast</Mono> · Junos <Mono>set protocols rstp interface ge-0/0/10 edge</Mono>. An edge port stops being edge as soon as a BPDU arrives.
        </p>
      </GuideSection>

      <GuideSection id="std-tc" eyebrow="Convergence" title="Topology change" tone="warning">
        <DiagramFrame caption="The tree changed, so MAC tables must be refreshed.">
          <TcDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="std-failover" eyebrow="Convergence" title="How traffic behaves, and what happens when a link fails" tone="warning">
        <p>Customer frames only cross forwarding ports. HOST-C → HOST-B goes SW3 → SW1 → SW2, never across the SW2–SW3 cable. SW2 does send floods onto that cable, but SW3 drops them on its Alternate port, so a broadcast reaches each host exactly once.</p>
        <DiagramFrame caption="Control plane and data plane use different paths across SW2–SW3.">
          <DataPathDiagram />
        </DiagramFrame>
        <p>When SW1–SW3 fails, SW3 loses its Root Port. With RSTP its Alternate port becomes Root Port immediately, the topology change flushes MAC entries learned on non-edge ports, and HOST-C → HOST-A now goes SW3 → SW2 → SW1 without losing a ping. When the cable comes back, SW3&apos;s direct path wins again and ge-0/0/2 returns to Alternate.</p>
        <DiagramFrame caption="The pre-computed backup becomes the Root Port.">
          <FailoverDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Discarding is not down" icon="!">
          SW3&apos;s ge-0/0/2 is physically up and keeps receiving BPDUs. Spanning tree only keeps customer frames off it: they are neither forwarded nor learned there.
        </Callout>
      </GuideSection>

      <GuideSection id="std-guards" eyebrow="Protection" title="BPDU guard and root guard" tone="danger">
        <p>The election trusts every BPDU. A switch plugged into a spare port with a low priority wins it, and a port that ignores BPDUs takes itself out of the tree. Two protections keep the tree you designed:</p>
        <CompareCards
          items={[
            { title: "BPDU guard", tone: "danger", tag: "host ports", points: ["Any BPDU → the port is err-disabled", "Cisco: spanning-tree bpduguard enable (recover: shutdown / no shutdown)", "Junos: set protocols layer2-control bpdu-block interface ge-0/0/11 (recover: clear error bpdu interface ge-0/0/11)"] },
            { title: "Root guard", tone: "violet", tag: "toward switches", points: ["A better root offered → the port is blocked (root-inconsistent)", "Cisco: spanning-tree guard root", "Junos: set protocols rstp interface ge-0/0/11 no-root-port", "Recovers by itself when the better BPDUs stop"] },
          ]}
        />
        <Callout tone="warning" title="BPDU filter is not a protection" icon="!">
          <Mono>spanning-tree bpdufilter enable</Mono> makes a port stop sending and processing BPDUs. On a port toward another switch it removes that port from the tree, which is exactly how a loop comes back.
        </Callout>
      </GuideSection>

      <LoopGuardSection />
      <GuideSection id="std-state" eyebrow="Operations" title="The state each switch keeps" tone="cyan">
        <p>Each switch keeps a few facts about the tree. Every verification and every fault below is about one of them:</p>
        <FlowSteps
          steps={[
            { title: "Who the root is", body: "The Root ID (priority + MAC) every switch agrees on, and this switch's own Bridge ID.", tone: "success" },
            { title: "Its path to the root", body: "The Root Port and the root path cost through it.", tone: "cyan" },
            { title: "Every port's role and state", body: "Root, Designated or Alternate; Forwarding, Learning or Discarding (BLK on Cisco); edge or not; guards.", tone: "warning" },
            { title: "Timers and counters", body: "Protocol (RSTP or legacy STP), hello 2 s, max age 20 s, forward delay 15 s; BPDUs sent and received; topology changes.", tone: "violet" },
          ]}
        />
      </GuideSection>

      <GuideSection id="std-verify" eyebrow="Operations" title="How to verify: four questions" tone="success">
        <p>Ask the same four questions every time, on every switch:</p>
        <FlowSteps
          steps={[
            { title: "Who is the root, and does everyone agree?", body: <>Cisco <Mono>show spanning-tree root</Mono> (or the top of <Mono>show spanning-tree</Mono>) · Junos <Mono>show spanning-tree bridge</Mono>.</>, tone: "success" },
            { title: "Which port leads to the root, at what cost?", body: <>Cisco <Mono>show spanning-tree</Mono> (Root line and the Root port) · Junos <Mono>show spanning-tree bridge</Mono> (Root cost, Root port).</>, tone: "cyan" },
            { title: "Which port blocks, and why that one?", body: <>Cisco <Mono>show spanning-tree blockedports</Mono> and <Mono>show spanning-tree interface Gi1/0/2 detail</Mono> · Junos <Mono>show spanning-tree interface</Mono> (role ALT, state BLK).</>, tone: "warning" },
            { title: "Protocol, edge ports and guards?", body: <>Cisco <Mono>show spanning-tree summary</Mono>, the Type column (P2p Edge), <Mono>show interfaces status</Mono> (err-disabled) · Junos <Mono>show configuration protocols rstp</Mono>, <Mono>show interfaces terse</Mono>.</>, tone: "violet" },
          ]}
        />
        <p>Then prove it with traffic: one ARP broadcast reaches each host once, pings take the expected path, and a cable unplugged costs no pings. Cisco also logs MAC flaps (<Mono>show logging</Mono>), the signature of a loop.</p>
      </GuideSection>

      <GuideSection id="std-normal" eyebrow="Operations" title="What a healthy tree looks like on the devices" tone="success">
        <NormalState />
      </GuideSection>

      <GuideSection id="std-signatures" eyebrow="Troubleshooting" title="Failure signatures: loops, detours and delays" tone="danger">
        <p>Spanning-tree problems reach you in three shapes: the whole LAN crawls (a loop), traffic takes a strange detour (the wrong root or the wrong Root Port), or the network disappears for half a minute after a change (timers or edge ports):</p>
        <FailureSignatures
          items={[
            { tag: "loop", title: "A port outside spanning tree", tone: "danger", points: ["Duplicates (DUP!), MAC flap messages, counters racing", "No port blocks with all links up", "Cisco: Bpdu filter is enabled · Junos: rstp interface … disable"] },
            { tag: "rogue", title: "A stray switch became root", tone: "violet", points: ["The Root ID is a MAC you don't know, with a priority lower than your core", "Traffic detours through one access switch", "Fix: unplug it, then BPDU guard or root guard on that port"] },
            { tag: "cost", title: "A wrong port cost", tone: "warning", points: ["The root is right, but a switch's Root Port is not the direct link", "The direct link is Alternate and idle", "Look at the cost on the receiving switch's port"] },
            { tag: "timers", title: "Legacy STP or a non-edge host port", tone: "ip", points: ["30–50 s outage after a link failure (legacy STP)", "30 s without network after a PC reboots (non-edge)", "protocol ieee · no P2p Edge"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="std-workflow" eyebrow="Troubleshooting" title="Investigation workflow: read the tree before you touch it" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What kind of problem: a loop, a detour, or an outage after a change?", look: "Loop: duplicate replies (DUP!), MAC flap logs, counters racing. Detour: works but slow, a link idle. Outage: a gap of 30 s+ after a link or host comes up." },
            { question: "Is the root the switch you designed?", look: "show spanning-tree root / show spanning-tree bridge on every switch. A different root: priorities, or a stray switch." },
            { question: "Is each Root Port the expected one?", look: "Compare the costs: the neighbor's cost plus the cost of the receiving port. A changed port cost moves the Root Port." },
            { question: "Does exactly one port block per loop?", look: "show spanning-tree blockedports / show spanning-tree interface. None blocking with all links up means a port outside spanning tree." },
            { question: "Timers: legacy STP anywhere? Host ports edge? Guards?", look: "protocol ieee / Enabled protocol STP · host ports without P2p Edge · show interfaces status: err-disabled · show logging." },
          ]}
        />
      </GuideSection>

      <GuideSection id="std-faults" eyebrow="Troubleshooting" title="Five faults, from evidence to proof" tone="danger">
        <FaultWalks />
      </GuideSection>

      <GuideSection id="std-prove" eyebrow="Troubleshooting" title="Prove the repair with fresh traffic" tone="success">
        <ChecklistCard
          tone="success"
          title="The proof, every time"
          mark="✓"
          items={[
            "Repeat the exact test that failed, and see it succeed",
            "Every switch names the designed root (SW1), and each Root Port is the expected one",
            "Exactly one port blocks in the triangle, with every cable up",
            "One fresh ARP broadcast reaches each host exactly once; no new MAC-flap messages",
            "Unplug a cable that carries traffic: the next ping still works (RSTP), then plug it back",
          ]}
        />
        <p>The lab&apos;s tickets check exactly this: a ticket only closes when the tree is right <em>and</em> a fresh run of the user&apos;s test succeeds.</p>
      </GuideSection>

      <GuideSection id="std-variants" eyebrow="Beyond this lesson" title="PVST+, MSTP and real designs" tone="violet">
        <p>The lab runs one tree for the whole LAN. Real networks with VLANs usually run more than one:</p>
        <FlowSteps
          steps={[
            { title: "One tree per VLAN (Cisco PVST+ / Rapid PVST+)", body: "Each VLAN elects its own root, which is why Cisco folds the VLAN number into the priority (24576 + VLAN 1 = 24577). Different VLANs can block different links and use both.", tone: "cyan" },
            { title: "A few trees for many VLANs (MSTP, 802.1s)", body: "VLANs are mapped to a small number of instances, each with its own tree. Standard across vendors, and the usual choice in mixed Cisco/Junos networks.", tone: "violet" },
            { title: "Place the root on purpose", body: "Make the core or distribution switch root with a low priority, a second switch the backup root, and protect access ports with BPDU guard.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="std-lacp" eyebrow="Beyond this lesson" title="Spanning tree does not add bandwidth" tone="violet">
        <CompareCards
          items={[
            { title: "STP / RSTP", tone: "ethernet", tag: "topology", points: ["Keeps a redundant topology loop-free", "Leaves some links non-forwarding", "Provides failover, not extra capacity"] },
            { title: "Link aggregation (LACP)", tone: "cyan", tag: "one logical link", points: ["Bundles parallel links between the same two devices", "All healthy members can forward", "STP sees the bundle as one path"] },
          ]}
        />
        <p>LACP, the next lesson, solves a different problem: it turns parallel cables between two switches into one logical link, which spanning tree then sees as a single path.</p>
      </GuideSection>

      <GuideSection id="std-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "The switch with the lowest MAC is always root.", correction: "The priority is compared first. The MAC only breaks ties, which is why the core switch is given a lower priority on purpose." },
            { myth: "A blocked port means the link is down.", correction: "The link is up and the Alternate port keeps processing BPDUs. It only keeps customer frames off the link." },
            { myth: "Path cost is counted on the sending port.", correction: "Each switch adds the cost of the port where the BPDU arrives, then advertises the total onward." },
            { myth: "RSTP is fast on every port.", correction: "Fast transitions need an agreement. Toward a PC there is none, so host ports must be edge ports or they wait 30 s." },
            { myth: "BPDU filter protects a port.", correction: "It removes the port from spanning tree. On a link toward a switch that brings the loop back. BPDU guard and root guard are the protections." },
            { myth: "Spanning tree load-balances the links.", correction: "One tree uses one path between any two switches. Extra capacity comes from link aggregation, or from per-VLAN or per-instance trees." },
          ]}
        />
      </GuideSection>

      <GuideSection id="std-quiz" eyebrow="Master it" title="Knowledge check" tone="success">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="std-explain" eyebrow="Master it" title="Can you explain it?" tone="success">
        <ExplainIt
          items={[
            { q: "Why is SW3's end of the SW2–SW3 cable the one that blocks, and not SW2's?", a: `Both ends offer the root at cost ${LINK_COST}. The tie goes to the lower sender Bridge ID: SW2 (…:02) beats SW3 (…:03). SW2's end is Designated; SW3's end is neither Root nor Designated, so it is Alternate.` },
            { q: "Why does HOST-C → HOST-B go through SW1 although SW3 and SW2 are directly connected?", a: "SW3's port on the direct cable is Alternate/Discarding. Customer frames only cross forwarding ports, so the path is SW3 → SW1 → SW2." },
            { q: "Why does a link failure cost no pings with RSTP but 30 s or more with legacy STP?", a: "RSTP keeps the Alternate port as a pre-computed backup and promotes it at once. Legacy STP has no Alternate role: the new Root Port goes through Listening and Learning on timers (15 s each), plus max age when the failure is indirect." },
            { q: "Why does a small switch plugged into a spare port change the whole network's paths?", a: "If its priority is lower than SW1's, it wins the election. Every switch then points at it, Root Ports move, and traffic detours through that access port. BPDU guard or root guard on the port prevents it." },
          ]}
        />
      </GuideSection>

      <GuideSection id="std-practice" eyebrow="Practice" title="Practice in the STP Lab" tone="cyan">
        <ChecklistCard
          tone="cyan"
          title="In the lab you will"
          mark="→"
          items={[
            "Make SW2 root, and move the blocked port with a cost change",
            "Catch the Alternate port discarding while it still receives BPDUs",
            "Fail a link without losing a ping, and close the 30-second gap on a host port",
            "Keep SW1 root when a small switch is plugged into a spare port",
            "Solve five tickets from evidence, on Cisco IOS or Junos, and prove each repair",
          ]}
        />
        <PresentationBridge>See the election, the blocked port, a failover and a rogue root animated in the STP presentation.</PresentationBridge>
        <LabBridge />
      </GuideSection>
    </div>
  );
}
