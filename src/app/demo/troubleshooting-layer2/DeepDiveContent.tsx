import { CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram } from "@/components/lesson/TroubleshootingGuideSvg";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { L2_IP, MGMT, MGMT_VLAN, USER_VLAN } from "@/lib/sim-engine/scenarios/troubleshootingLayer2";
import { createL2Net, l2Apply, l2Healthy, type L2Action, type L2State } from "@/lib/sim-engine/scenarios/l2Net";
import { L2G, L2Result, L2_FIX, L2_INC, l2Cli, l2Only, l2TicketRun, pAB } from "./LessonGuideContent";

const G2 = { foundation: "Foundation", vlans: "VLANs and trunks", stp: "Spanning tree", trouble: "Troubleshooting", master: "Master it" };
export const L2_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "l2d-why", label: "Why Layer 2 fails quietly", group: G2.foundation },
  { id: "l2d-learning", label: "Learning and forwarding", group: G2.foundation },
  { id: "l2d-aging", label: "Aging", group: G2.foundation },
  { id: "l2d-flood", label: "Flooding", group: G2.foundation },
  { id: "l2d-trunk", label: "Access, trunk and native", group: G2.vlans },
  { id: "l2d-8021q", label: "The tagged frame", group: G2.vlans },
  { id: "l2d-classify", label: "Egress tagging, ingress classification", group: G2.vlans },
  { id: "l2d-allowed", label: "Trunk misconfigurations", group: G2.vlans },
  { id: "l2d-stp", label: "Roles and states", group: G2.stp },
  { id: "l2d-election", label: "The election, step by step", group: G2.stp },
  { id: "l2d-loops", label: "Loops and storms", group: G2.stp },
  { id: "l2d-lag", label: "Aggregated links", group: G2.stp },
  { id: "l2d-signatures", label: "Failure signatures", group: G2.trouble },
  { id: "l2d-ladder", label: "The troubleshooting ladder", group: G2.trouble },
  { id: "l2d-tickets", label: "Five faults, evidence to proof", group: G2.trouble },
  { id: "l2d-myths", label: "Common misconceptions", group: G2.master },
  { id: "l2d-quiz", label: "Knowledge check", group: G2.master },
  { id: "l2d-explain", label: "Can you explain it?", group: G2.master },
  { id: "l2d-glossary", label: "Glossary", group: G2.master },
  { id: "l2d-mental", label: "Mental model", group: G2.master },
  { id: "l2d-practice", label: "Practice in the lab", group: G2.master },
];

function LearningDiagram() {
  return (
    <DiagramSvg h={170} label="A switch learns the source MAC on the ingress port and forwards by destination MAC: known unicast to one port, unknown or broadcast flooded within the VLAN">
      <DNode x={320} y={60} label="Switch" sub="VLAN 10 table" accent={D.eth} w={120} h={50} />
      <DNode x={100} y={60} label="A" sub="port 1" accent={D.cyan} w={70} />
      <DNode x={540} y={30} label="B" sub="port 2" accent={D.success} w={70} />
      <DNode x={540} y={100} label="C" sub="port 3" accent={D.success} w={70} />
      <DArrow x1={138} y1={60} x2={258} y2={60} color={D.cyan} label="src A · dst B" />
      <DLink x1={382} y1={52} x2={502} y2={34} />
      <DLink x1={382} y1={70} x2={502} y2={96} />
      <text x={320} y={138} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Learn: (VLAN 10, A) → port 1. Forward: B known → port 2 only; B unknown → flood ports 2 and 3.
      </text>
      <text x={320} y={156} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Learning is per VLAN: the same MAC may appear in two VLANs on different ports.
      </text>
    </DiagramSvg>
  );
}

function AgingDiagram() {
  return (
    <DiagramSvg h={120} label="A MAC entry is refreshed by each frame from that MAC and removed when no frame arrives within the aging time, typically 300 seconds">
      <line x1={40} y1={60} x2={600} y2={60} stroke={D.line} />
      {[60, 140, 220].map((x) => (
        <DPill key={x} x={x} y={60} text="frame" color={D.success} w={54} />
      ))}
      <DPill x={560} y={60} text="entry removed" color={D.warning} w={110} />
      <text x={390} y={48} textAnchor="middle" fill={D.muted} fontSize={9} fontFamily="monospace">
        ← 300 s with no frame from this MAC →
      </text>
      <text x={320} y={100} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Aging keeps tables current when hosts move or go quiet. A host that only receives can age out of remote tables.
      </text>
    </DiagramSvg>
  );
}

function TrunkDiagram() {
  return (
    <DiagramSvg h={140} label="On a trunk, VLAN 10 and 20 frames are tagged; native VLAN 1 frames are untagged; both ends must agree on native VLAN and allowed lists">
      <DNode x={110} y={70} label="SW-X" sub="trunk" accent={D.eth} w={100} h={60} />
      <DNode x={530} y={70} label="SW-Y" sub="trunk" accent={D.eth} w={100} h={60} />
      <DArrow x1={162} y1={48} x2={478} y2={48} color={D.violet} label="VLAN 10 → tag VID 10" labelDy={-5} />
      <DArrow x1={162} y1={72} x2={478} y2={72} color={D.success} label="VLAN 20 → tag VID 20" labelDy={-5} />
      <DArrow x1={162} y1={96} x2={478} y2={96} color={D.faint} label="native VLAN 1 → untagged" labelDy={-5} />
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Untagged frames arriving on a trunk are placed in that port&apos;s native VLAN.
      </text>
    </DiagramSvg>
  );
}

function HeaderDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={120} label="802.1Q frame layout: destination MAC, source MAC, 4-byte tag with TPID and TCI, EtherType, payload, FCS">
      <DFieldRow x={20} y={14} fields={[f("Dst MAC", "6", 80, D.eth), f("Src MAC", "6", 80, D.eth), f("TPID 0x8100", "2", 100, D.violet, true), f("TCI", "2 · PCP|DEI|VID", 120, D.violet, true), f("EtherType", "2", 80, D.eth), f("Payload", "46–1500", 90, D.ip), f("FCS", "4", 50, D.warning)]} />
      <text x={320} y={98} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        VID 0 and 4095 are reserved: usable VLANs 1–4094. Max frame grows from 1518 to 1522 bytes.
      </text>
    </DiagramSvg>
  );
}

function AllowedNativeDiagram() {
  return (
    <DiagramSvg h={170} label="Common trunk misconfigurations and their symptoms: VLAN missing from an allowed list, native VLAN mismatch, trunk versus access mismatch">
      <DTable
        x={20}
        y={8}
        title="Trunk misconfigurations and their fingerprints"
        cols={[
          { label: "PROBLEM", w: 180 },
          { label: "SYMPTOM", w: 280 },
          { label: "EVIDENCE", w: 140 },
        ]}
        rows={[
          ["VLAN missing from allowed list", "one VLAN fails, others fine", "allowed lists, both ends"],
          ["Native VLAN mismatch", "untagged traffic leaks between VLANs", "native on both ends"],
          ["Trunk vs access mismatch", "tagged frames dropped or mis-classified", "port modes"],
          ["VLAN not created on a switch", "VLAN fails through that switch", "VLAN database"],
        ]}
      />
    </DiagramSvg>
  );
}

function StpDiagram() {
  return (
    <DiagramSvg h={170} label="RSTP port roles and states: root and designated ports forward, alternate and backup ports discard; states discarding, learning, forwarding">
      <DTable
        x={40}
        y={8}
        title="RSTP roles → state in a stable tree"
        cols={[
          { label: "ROLE", w: 140 },
          { label: "STATE", w: 130 },
          { label: "MEANING", w: 290 },
        ]}
        rows={[
          ["Root", "Forwarding", "best path toward the root bridge"],
          ["Designated", "Forwarding", "best port onto its segment"],
          ["Alternate", "Discarding", "backup path to root — breaks the loop"],
          ["Backup", "Discarding", "second port on the same segment"],
          ["Edge", "Forwarding", "host port, no BPDUs expected"],
        ]}
      />
    </DiagramSvg>
  );
}

function FloodDiagram() {
  return (
    <DiagramSvg h={150} label="Broadcast and unknown unicast frames are flooded to every forwarding port in the same VLAN except the one they arrived on">
      <DNode x={320} y={70} label="Switch" sub="VLAN 10" accent={D.eth} w={110} h={50} />
      <DNode x={90} y={70} label="in" sub="VLAN 10" accent={D.cyan} w={70} />
      <DNode x={550} y={25} label="port" sub="VLAN 10" accent={D.success} w={80} />
      <DNode x={550} y={80} label="port" sub="VLAN 10" accent={D.success} w={80} />
      <DNode x={550} y={130} label="port" sub="VLAN 20" accent={D.faint} w={80} h={30} />
      <DArrow x1={125} y1={70} x2={265} y2={70} color={D.cyan} label="broadcast" />
      <DArrow x1={375} y1={62} x2={508} y2={30} color={D.success} />
      <DArrow x1={375} y1={74} x2={508} y2={80} color={D.success} />
      <text x={455} y={128} textAnchor="middle" fill={D.faint} fontSize={9}>
        not flooded (other VLAN)
      </text>
    </DiagramSvg>
  );
}

function LagDiagram() {
  return (
    <DiagramSvg h={140} label="A port-channel bundles member links into one logical port: VLAN and trunk settings must match on every member, STP sees one port, and flows are hashed across members">
      <DNode x={110} y={65} label="SW-X" sub="ae0 / Po1" accent={D.eth} w={110} h={60} />
      <DNode x={530} y={65} label="SW-Y" sub="ae0 / Po1" accent={D.eth} w={110} h={60} />
      <DLink x1={165} y1={52} x2={475} y2={52} color={D.success} label="member 1" />
      <DLink x1={165} y1={78} x2={475} y2={78} color={D.success} label="member 2" />
      <text x={320} y={122} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        One logical trunk: allowed VLANs live on the bundle; mismatched members are suspended. STP sees a single port.
      </text>
    </DiagramSvg>
  );
}

function LoopDiagram() {
  return (
    <DiagramSvg h={170} label="Layer-2 loop symptoms: broadcast storm, MAC flapping between ports, high CPU, and all VLANs on the loop failing">
      <DTable
        x={30}
        y={8}
        title="A real Layer-2 loop looks like this — nothing like a missing VLAN"
        cols={[
          { label: "SYMPTOM", w: 220 },
          { label: "WHERE YOU SEE IT", w: 360 },
        ]}
        rows={[
          ["Broadcast storm", "interface rates at line rate, mostly broadcast"],
          ["MAC flapping", "the same MAC learned on two ports, alternating"],
          ["High switch CPU", "control plane starved; management slow"],
          ["Everything on the loop fails", "every VLAN on those links, not just one"],
        ]}
      />
    </DiagramSvg>
  );
}


const run = (s: L2State, ...a: L2Action[]) => a.reduce((acc, x) => l2Apply(acc, x), s);
const HC = l2Healthy();
const T = { access: run(l2TicketRun("access"), { type: "ping", from: "HOST-B", to: L2_IP["HOST-A"], count: 1 }), native: l2TicketRun("native"), loop: l2TicketRun("loop"), trunkmode: l2TicketRun("trunkmode") };
const F = {
  access: run(T.access, { type: "cfg", dev: "SW3", cfg: HC.SW3, text: "fix" }, pAB),
  native: run(T.native, { type: "cfg", dev: "SW1", cfg: HC.SW1, text: "fix" }, pAB),
  loop: run(T.loop, { type: "cfg", dev: "SW1", cfg: HC.SW1, text: "fix" }, pAB),
  trunkmode: run(T.trunkmode, { type: "cfg", dev: "SW3", cfg: HC.SW3, text: "fix" }, pAB, { type: "ping", from: "SW1", to: MGMT.SW3.ip, count: 4 }),
};
const ROOT3 = run(createL2Net(0), { type: "cfg", dev: "SW3", cfg: { ...HC.SW3, prio: 0 }, text: "bridge-priority 0" }, pAB);

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Layer 2 Lab" onPractice={openLab}>
      Every port&apos;s VLANs and spanning-tree role, all three MAC tables, port counters, pings in VLAN 10 and VLAN 20, Junos EX and Linux consoles — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const QUIZ: KnowledgeQuestion[] = [
  { id: "q-learn", prompt: "A switch receives a frame from MAC X on port 3 in VLAN 10. What does it record?", options: [{ id: "a", label: "VLAN 10 + MAC X → port 3" }, { id: "b", label: "The destination MAC → port 3" }, { id: "c", label: "MAC X → every port" }], correctId: "a", explanation: "Learning uses the source address, the ingress port and the classified VLAN." },
  { id: "q-flood", prompt: "The destination MAC isn't in the table. What happens?", options: [{ id: "a", label: "Flooded out of every forwarding port in the same VLAN except the ingress port" }, { id: "b", label: "Dropped" }, { id: "c", label: "Sent to the root bridge" }], correctId: "a", explanation: "Unknown unicast is treated like a broadcast within the VLAN." },
  { id: "q-allowed", prompt: "VLAN 10 is missing from one trunk's member list. Typical symptom?", options: [{ id: "a", label: "VLAN 10 stops at that trunk; the link and other VLANs keep working" }, { id: "b", label: "The link goes down" }, { id: "c", label: "Spanning tree reconverges" }], correctId: "a", explanation: "Membership is per VLAN; nothing physical changes." },
  { id: "q-native", prompt: "A host's MAC shows up in VLAN default on a trunk port. What do you suspect?", options: [{ id: "a", label: "A native VLAN mismatch: the frame was sent untagged and classified into the receiver's native VLAN" }, { id: "b", label: "The host is in VLAN 1" }, { id: "c", label: "MAC aging" }], correctId: "a", explanation: "Untagged frames on a trunk belong to the receiving port's native VLAN." },
  { id: "q-alt", prompt: "Which port does RSTP block in the triangle?", options: [{ id: "a", label: "The one on the link not toward the root whose bridge has the worse root path or bridge ID" }, { id: "b", label: "The root bridge's ports" }, { id: "c", label: "Always the slowest link" }], correctId: "a", explanation: "Each link gets one designated end (better cost, then bridge ID); a non-designated, non-root port is Alternate." },
  { id: "q-storm", prompt: "Counters climb by 100,000s per second, MACs flap, the CPU is pegged. Most likely?", options: [{ id: "a", label: "A forwarding loop: no port blocked" }, { id: "b", label: "A duplex mismatch" }, { id: "c", label: "A missing VLAN" }], correctId: "a", explanation: "Broadcasts multiply in a loop; source MACs arrive from both directions." },
];

export function L2DeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="l2d-why" eyebrow="Foundation" title="Why Layer 2 fails quietly" tone="cyan">
        <p>
          A switch never tells the sender it dropped a frame. A VLAN missing from a trunk, a wrong native VLAN or a port in the wrong VLAN produce no error message, no link change, no alarm — just silence, often for one VLAN only. The only witnesses are the switches&apos; tables: MAC tables, VLAN membership, spanning-tree roles and port counters.
        </p>
        <CompareCards
          items={[
            { title: "MAC tables", tone: "cyan", tag: "where frames came from", points: ["VLAN + MAC → port", "absence = never arrived"] },
            { title: "VLAN membership", tone: "violet", tag: "where frames may go", points: ["access VLAN, trunk members", "native VLAN, both ends"] },
            { title: "Spanning tree", tone: "success", tag: "which ports forward", points: ["root, roles, states", "exactly one blocked port per loop"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="l2d-learning" eyebrow="Foundation" title="Learning and forwarding" tone="cyan">
        <DiagramFrame caption="Learn the source, forward by the destination.">
          <LearningDiagram />
        </DiagramFrame>
        <CliPanel run={l2Cli(L2G, "SW2", "show ethernet-switching table")} caption="Junos · SW2 — both hosts in USERS, SW1's and SW3's IRB MACs in MGMT" />
      </GuideSection>

      <GuideSection id="l2d-aging" eyebrow="Foundation" title="Aging" tone="warning">
        <DiagramFrame caption="Each frame refreshes its entry; silence removes it.">
          <AgingDiagram />
        </DiagramFrame>
        <p className="text-sm text-pv-text-muted">After 300 s without a frame from a MAC, its entry disappears and traffic toward it is flooded again until it speaks. An empty table after a quiet period proves nothing — send traffic first, then read the table. A spanning-tree topology change flushes learned entries on the affected ports, too.</p>
      </GuideSection>

      <GuideSection id="l2d-flood" eyebrow="Foundation" title="Flooding" tone="cyan">
        <DiagramFrame caption="Broadcast and unknown unicast go everywhere in the VLAN.">
          <FloodDiagram />
        </DiagramFrame>
        <p>ARP requests are broadcasts, so the very first frame between two hosts is flooded through the whole VLAN — following only forwarding ports that carry the VLAN. That makes ARP the perfect probe: wherever it can&apos;t go, the VLAN is broken.</p>
      </GuideSection>

      <GuideSection id="l2d-trunk" eyebrow="VLANs and trunks" title="Access, trunk and native" tone="violet">
        <DiagramFrame caption="Tagged VLANs and one untagged native VLAN on a trunk.">
          <TrunkDiagram />
        </DiagramFrame>
        <FieldTable
          title="Junos ELS configuration"
          accent="violet"
          columns={["Port type", "Statements"]}
          rows={[
            ["Access", <Mono key="a">set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode access vlan members USERS</Mono>],
            ["Trunk", <Mono key="t">set interfaces ge-0/0/51 unit 0 family ethernet-switching interface-mode trunk vlan members [ USERS MGMT ]</Mono>],
            ["Native VLAN", <Mono key="n">set interfaces ge-0/0/51 native-vlan-id 1</Mono>],
            ["VLAN definition", <Mono key="v">set vlans USERS vlan-id 10</Mono>],
          ]}
        />
        <p className="text-sm text-pv-text-muted">An access interface can be a member of only one VLAN — Junos refuses the commit otherwise. A trunk without a native VLAN drops untagged data frames.</p>
      </GuideSection>

      <GuideSection id="l2d-8021q" eyebrow="VLANs and trunks" title="The tagged frame" tone="violet">
        <DiagramFrame caption="Where the 4-byte tag sits.">
          <HeaderDiagram />
        </DiagramFrame>
        <p className="text-sm text-pv-text-muted">The tag adds 4 bytes, so a full-size tagged frame is 1522 bytes. The 12-bit VID allows VLANs 1–4094 (0 and 4095 are reserved); the 3-bit PCP carries 802.1p priority.</p>
      </GuideSection>

      <GuideSection id="l2d-classify" eyebrow="VLANs and trunks" title="Egress tagging, ingress classification" tone="ip">
        <p>Two decisions per hop decide where a frame lives. On <b className="text-pv-text">egress</b> the sender tags it with its VLAN — unless that VLAN is the port&apos;s native VLAN or the port is an access port, then it goes untagged. On <b className="text-pv-text">ingress</b> the receiver reads the tag — or, if there is none, uses its own access or native VLAN. The two ends never compare notes.</p>
        <FieldTable
          title="Ingress classification"
          accent="ip"
          columns={["Arriving on", "Frame", "Result"]}
          rows={[
            ["access port, VLAN 10", "untagged", "VLAN 10"],
            ["access port", "tagged", "dropped (input drop)"],
            ["trunk, members 10 20, native 1", "tag 10", "VLAN 10"],
            ["trunk, members 20, native 1", "tag 10", "dropped: VLAN not allowed"],
            ["trunk, native 1", "untagged", "VLAN 1 (default) — whatever the sender meant"],
          ]}
        />
        <CliPanel run={l2Cli(T.native, "SW1", "show ethernet-switching interface ge-0/0/49")} caption="Junos · SW1 with native-vlan-id 10 — USERS now leaves untagged" />
      </GuideSection>

      <GuideSection id="l2d-allowed" eyebrow="VLANs and trunks" title="Trunk misconfigurations" tone="danger">
        <DiagramFrame caption="Three classic trunk faults.">
          <AllowedNativeDiagram />
        </DiagramFrame>
        <CliPanel run={l2Only(T.trunkmode, "SW3", "show interfaces ge-0/0/51 extensive", /Physical interface|Drops: /)} caption="Junos · SW3 — an access port facing a trunk: every tagged frame counted as an input drop" />
      </GuideSection>

      <GuideSection id="l2d-stp" eyebrow="Spanning tree" title="Roles and states" tone="success">
        <DiagramFrame caption="RSTP port roles and states.">
          <StpDiagram />
        </DiagramFrame>
        <CliPanel run={l2Cli(L2G, "SW3", "show spanning-tree interface")} caption="Junos · SW3 — ge-0/0/51 ROOT, ge-0/0/50 DESG toward SW1, ge-0/0/1 an edge port" />
      </GuideSection>

      <GuideSection id="l2d-election" eyebrow="Spanning tree" title="The election, step by step" tone="success">
        <TroubleshootingFlow
          steps={[
            { question: "1 · Root bridge", look: "lowest bridge ID = priority, then MAC: SW2 (4096) beats SW3 (8192) and SW1 (32768)" },
            { question: "2 · Root port on every other bridge", look: "lowest cost to the root (20000 per link), then neighbour bridge ID, then port ID" },
            { question: "3 · Designated port on every link", look: "the end with the lower root cost, then lower bridge ID: SW3 wins the SW1–SW3 link" },
            { question: "4 · Everything else", look: "Alternate, discarding: SW1 ge-0/0/50" },
          ]}
        />
        <p>Change one priority and the whole tree moves. With SW3 at priority 0, SW3 becomes root and the blocked port moves to the SW1–SW2 link:</p>
        <CliPanel run={l2Only(ROOT3, "SW1", "show spanning-tree bridge", /Root ID|Root cost|Root port/)} caption="Junos · SW1 — root SW3, reached via ge-0/0/50 now" />
        <CliPanel run={l2Only(ROOT3, "SW1", "show spanning-tree interface", /Interface|ge-0\/0\/49|ge-0\/0\/50/)} caption="Junos · SW1 — ge-0/0/50 ROOT now; ge-0/0/49 is the new Alternate (SW2 wins that link on bridge ID)" />
        <L2Result s={ROOT3} title="The lab: hosts still reach each other over the new tree" />
      </GuideSection>

      <GuideSection id="l2d-loops" eyebrow="Spanning tree" title="Loops and storms" tone="danger">
        <DiagramFrame caption="What a Layer 2 loop looks like.">
          <LoopDiagram />
        </DiagramFrame>
        <p>A switch without spanning tree forwards on every port and consumes BPDUs (reserved 01:80:C2:00:00:00 frames are never bridged). Its neighbours see no RSTP partner on those ports, so they forward too — and the triangle has no blocked port. One broadcast becomes millions.</p>
        <CliPanel run={l2Cli(T.loop, "SW1", "show spanning-tree bridge")} caption="Junos · SW1 — no spanning tree" />
        <CliPanel run={l2Only(T.loop, "SW2", "show interfaces ge-0/0/51 extensive", /Input  packets|Broadcast packets/)} caption="Junos · SW2 — broadcasts by the hundred thousand" />
        <L2Result s={T.loop} title="The lab: pings during the storm" />
      </GuideSection>

      <GuideSection id="l2d-lag" eyebrow="Spanning tree" title="Aggregated links" tone="cyan">
        <DiagramFrame caption="A bundle is one logical port.">
          <LagDiagram />
        </DiagramFrame>
        <p className="text-sm text-pv-text-muted">An aggregated Ethernet (ae) bundle appears to spanning tree and to VLAN membership as one port: configure the VLANs on the ae interface, not on its members. A member with different settings, or a bundle formed on one side only, behaves like a mismatch or a loop.</p>
      </GuideSection>

      <GuideSection id="l2d-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "PRUNE", title: "VLAN missing on a trunk", tone: "danger", points: ["frame stops at one switch", "other VLANs on the link fine"] },
            { tag: "ACC", title: "Wrong access VLAN", tone: "warning", points: ["host MAC learned in another VLAN", "link up, IP right"] },
            { tag: "NAT", title: "Native mismatch", tone: "danger", points: ["MAC learned in VLAN default", "a VLAN leaks into another"] },
            { tag: "MODE", title: "Access vs trunk", tone: "danger", points: ["all VLANs fail on that link", "input drops; BPDUs still pass"] },
            { tag: "LOOP", title: "No blocked port", tone: "danger", points: ["broadcast storm", "MAC moves logged"] },
            { tag: "AGE", title: "Stale or empty tables", tone: "violet", points: ["nothing learned after silence", "send traffic, then read"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="l2d-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <DiagramFrame caption="Follow the VLAN switch by switch.">
          <DiagramSvg h={170} label="Layer 2 ladder">
            <LadderDiagram
              rows={[
                { rung: "Physical / interface", evidence: "up/up, errors by delta", status: "ok" },
                { rung: "Port mode", evidence: "access vs trunk, both ends", status: "ok" },
                { rung: "VLAN membership", evidence: "exists? allowed on every port?", status: "suspect" },
                { rung: "Native VLAN", evidence: "same on both ends", status: "ok" },
                { rung: "STP state", evidence: "needed ports forwarding?", status: "ok" },
                { rung: "MAC tables", evidence: "learned where expected?", status: "suspect" },
              ]}
            />
          </DiagramSvg>
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Scope", body: "Which VLAN fails, which works? One host or all?", tone: "cyan" },
            { title: "Follow the frame", body: "Send an ARP; read every MAC table on the path.", tone: "violet" },
            { title: "Compare both ends", body: "Mode, members, native, STP state on each link.", tone: "warning" },
            { title: "Fix one thing, re-test", body: "Fresh traffic; the tables must fill as expected.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="l2d-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk title="1 · HOST-A can't reach HOST-B" normal="Every trunk carries USERS and MGMT." change="The clean-up left SW2 ge-0/0/51 with MGMT only." evidence={<CliPanel run={l2Only(L2_INC, "SW2", "show ethernet-switching interface ge-0/0/51", /ge-0\/0\/51|MGMT|USERS|default/)} caption="Junos · SW2 — no USERS" />} next="SW2 learns HOST-A, SW3 doesn't; VLAN 20 crosses the same trunk." fix={<Mono>SW2: set interfaces ge-0/0/51 unit 0 family ethernet-switching vlan members USERS → commit</Mono>} proof={<L2Result s={L2_FIX} from={L2_INC.tests.length} title="A fresh ping" />} />
        <FailureWalk title="2 · HOST-B moved desks and vanished" normal="SW3 ge-0/0/1 access USERS." change="The new desk port was configured access MGMT." evidence={<CliPanel run={l2Only(T.access, "SW3", "show ethernet-switching table", /MGMT\s+00:00:5e:00:53:0b|Ethernet switching table/)} caption="Junos · SW3 — HOST-B in MGMT" />} next="HOST-B's frames enter VLAN 20; HOST-A's ARP in VLAN 10 never reaches that port." fix={<Mono>SW3: delete … vlan members MGMT · set … vlan members USERS → commit (an access port takes one VLAN)</Mono>} proof={<L2Result s={F.access} from={T.access.tests.length} title="A fresh ping" />} />
        <FailureWalk title="3 · Users can't reach each other since the template push" normal="Native VLAN 1 at both ends of every trunk." change="SW1 ge-0/0/49: native-vlan-id 10." evidence={<CliPanel run={l2Only(T.native, "SW2", "show ethernet-switching table", /default|Ethernet switching table/)} caption="Junos · SW2 — HOST-A in VLAN default" />} next="SW1 sends VLAN 10 untagged; SW2 files it under VLAN 1. Tagged VLAN 20 is fine." fix={<Mono>SW1: set interfaces ge-0/0/49 native-vlan-id 1 → commit</Mono>} proof={<L2Result s={F.native} from={T.native.tests.length} title="A fresh ping" />} />
        <FailureWalk title="4 · The whole network is crawling" normal="RSTP on all three switches; SW1 ge-0/0/50 Alternate." change="protocols rstp was deleted on SW1." evidence={<CliPanel run={l2Only(T.loop, "SW2", "show log messages", /MAC_MOVE/)} caption="Junos · SW2 — MACs flapping" />} next="No port blocked anywhere; broadcasts circle the triangle." fix={<Mono>SW1: set protocols rstp interface all · set protocols rstp bridge-priority 32768 → commit</Mono>} proof={<L2Result s={F.loop} from={T.loop.tests.length} title="A fresh ping, no storm" />} />
        <FailureWalk title="5 · SW3 and HOST-B both unreachable" normal="SW3 ge-0/0/51 trunk USERS MGMT, native 1." change="It was re-configured as access USERS." evidence={<CliPanel run={l2Only(T.trunkmode, "SW3", "show interfaces ge-0/0/51 extensive", /Drops: /)} caption="Junos · SW3 — input drops" />} next="SW2 sends tagged frames; an access port drops every tagged frame — VLAN 10 and VLAN 20." fix={<Mono>SW3: interface-mode trunk · vlan members MGMT · native-vlan-id 1 → commit</Mono>} proof={<L2Result s={F.trunkmode} from={T.trunkmode.tests.length} title="Fresh pings in both VLANs" />} />
      </GuideSection>

      <GuideSection id="l2d-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "If the link is up, VLANs pass.", correction: "Each VLAN must be a member at both ends; up links carry only their member VLANs." },
            { myth: "The native VLAN doesn't matter if nobody uses VLAN 1.", correction: "A mismatch reclassifies whatever is sent untagged — including a user VLAN." },
            { myth: "An empty MAC table means a broken switch.", correction: "Entries age out after 300 s; send traffic first." },
            { myth: "Spanning tree slows the network down.", correction: "It blocks one redundant port; without it a loop takes everything down." },
            { myth: "Blocked ports are a fault.", correction: "One Alternate port per loop is exactly what a healthy tree looks like." },
          ]}
        />
      </GuideSection>

      <GuideSection id="l2d-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="l2d-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why did management work while users failed?", a: `VLAN ${MGMT_VLAN} was still a member of SW2 ge-0/0/51; only VLAN ${USER_VLAN} had been removed.` },
            { q: "How do the MAC tables locate the fault?", a: "SW2 learned HOST-A (the ARP arrived), SW3 never did (it never left SW2 toward SW3)." },
            { q: "Why does a native mismatch put a host in VLAN default?", a: "The sender sends that VLAN untagged; the receiver puts untagged frames into its own native VLAN." },
            { q: "Why does removing RSTP from one switch create a loop?", a: "That switch forwards on all ports and swallows BPDUs, so its neighbours see no partner and forward too — no port is blocked." },
            { q: "Why does an access port facing a trunk break both VLANs?", a: "The trunk tags every VLAN; an access port drops every tagged frame." },
          ]}
        />
      </GuideSection>

      <GuideSection id="l2d-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Bridge ID", def: "Priority (multiples of 4096) + MAC; lowest wins the root election." },
            { term: "Root port", def: "A non-root bridge's best port toward the root." },
            { term: "Designated port", def: "The forwarding end of a link — the side closer to the root." },
            { term: "Alternate port", def: "A discarding backup port that breaks a loop." },
            { term: "Edge port", def: "A port to a host; forwards immediately, no BPDUs expected." },
            { term: "TCI", def: "802.1Q Tag Control Information: PCP, DEI and the 12-bit VLAN ID." },
            { term: "Ingress filtering", def: "Dropping a frame whose VLAN the arrival port doesn't carry." },
            { term: "MAC move", def: "A MAC learned on a new port — normal once, a loop sign when constant." },
          ]}
        />
      </GuideSection>

      <GuideSection id="l2d-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>Companies sharing corridors: coloured badges (VLANs), reception desks that give the colour silently (access ports), lifts that carry only listed colours with armbands (trunks and tags), notebooks of who came from where (MAC tables), and one roped-off corridor so nobody walks in circles (the blocked port).</p>
      </GuideSection>

      <GuideSection id="l2d-practice" eyebrow="Master it" title="Practice in the lab" tone="violet">
        <p>Six Learn levels, then the workspace: every port&apos;s VLANs and spanning-tree role, all three MAC tables, counters, pings in both VLANs, Junos EX and Linux consoles, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the Layer 2 presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
