import { Callout, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FlowSteps, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram } from "@/components/lesson/TroubleshootingGuideSvg";

export const L2_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "l2d-learning", label: "MAC learning" },
  { id: "l2d-aging", label: "CAM aging" },
  { id: "l2d-trunk", label: "Access, trunk, native" },
  { id: "l2d-8021q", label: "802.1Q header" },
  { id: "l2d-allowed", label: "Allowed vs native problems" },
  { id: "l2d-stp", label: "STP roles & states" },
  { id: "l2d-flood", label: "Broadcast & unknown unicast" },
  { id: "l2d-lag", label: "Port-channel context" },
  { id: "l2d-loops", label: "Layer-2 loop symptoms" },
  { id: "l2d-ladder", label: "Troubleshooting ladder" },
  { id: "l2d-glossary", label: "Glossary" },
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

export function L2DeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="l2d-learning" eyebrow="Switching" title="MAC learning and forwarding" tone="cyan">
        <DiagramFrame caption="Learn from the source, forward by the destination.">
          <LearningDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2d-aging" eyebrow="Switching" title="CAM / MAC-table aging" tone="warning">
        <DiagramFrame caption="Entries survive only while frames keep arriving.">
          <AgingDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2d-trunk" eyebrow="VLANs" title="Access, trunk and native VLAN" tone="violet">
        <DiagramFrame caption="Both ends of a trunk must agree.">
          <TrunkDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2d-8021q" eyebrow="802.1Q" title="The tagged frame" tone="violet">
        <DiagramFrame caption="Four bytes between the source MAC and the EtherType.">
          <HeaderDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2d-allowed" eyebrow="Trunks" title="Allowed-list and native-VLAN problems" tone="danger">
        <DiagramFrame caption="Each misconfiguration has its own fingerprint.">
          <AllowedNativeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2d-stp" eyebrow="Spanning tree" title="Roles and states" tone="success">
        <DiagramFrame caption="A discarding port is normal in a redundant topology.">
          <StpDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="Per-VLAN trees">
          RSTP builds one tree for all VLANs. Per-VLAN variants (Rapid PVST+) and MSTP can place different VLANs on different trees — then STP state really must be checked per VLAN.
        </Callout>
      </GuideSection>

      <GuideSection id="l2d-flood" eyebrow="Flooding" title="Broadcast and unknown unicast" tone="ethernet">
        <DiagramFrame caption="Flooding never crosses VLAN boundaries.">
          <FloodDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2d-lag" eyebrow="Context" title="Port-channels" tone="cyan">
        <DiagramFrame caption="Troubleshoot the bundle and its members.">
          <LagDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2d-loops" eyebrow="Loops" title="What a Layer-2 loop really looks like" tone="danger">
        <DiagramFrame caption="Loud, broad and fast — not one quiet VLAN.">
          <LoopDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="l2d-ladder" eyebrow="Ladder" title="A Layer-2 troubleshooting ladder" tone="cyan">
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
            { title: "Scope", body: "Which hosts, which VLAN, which path?", tone: "cyan" },
            { title: "Follow", body: "Each switch: accept, learn, lookup, egress.", tone: "violet" },
            { title: "Compare", body: "A second VLAN; both ends of each trunk.", tone: "warning" },
            { title: "Change one thing", body: "Then rerun the same tests.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="l2d-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "CAM / FDB", def: "The MAC address table: VLAN + MAC → port." },
            { term: "TPID", def: "Tag Protocol Identifier, 0x8100 for 802.1Q." },
            { term: "TCI", def: "Tag Control Information: PCP (3 bits), DEI (1 bit), VID (12 bits)." },
            { term: "MAC flapping", def: "One MAC learned alternately on two ports — a loop or a misbehaving host." },
            { term: "Port-channel / LAG", def: "Several links bundled into one logical port (LACP)." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
