import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BPDU_DST } from "@/lib/sim-engine/scenarios/stpRstp";

export const STP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "std-bid", label: "Bridge ID" },
  { id: "std-bpdu", label: "BPDU format" },
  { id: "std-vector", label: "Priority vectors" },
  { id: "std-roles", label: "Port roles" },
  { id: "std-states", label: "STP vs RSTP states" },
  { id: "std-sync", label: "Proposal / agreement" },
  { id: "std-tc", label: "Topology change" },
  { id: "std-edge", label: "Edge ports" },
  { id: "std-compare", label: "STP vs link aggregation" },
  { id: "std-workflow", label: "Troubleshooting" },
  { id: "std-verify", label: "Verification" },
  { id: "std-model", label: "Mental model" },
  { id: "std-glossary", label: "Glossary" },
];

function BridgeIdDiagram() {
  return (
    <DiagramSvg h={150} label="A Bridge ID is 8 bytes: a 2-byte priority followed by the bridge's 6-byte MAC address; lower is better, priority compared first">
      <DFieldRow x={60} y={30} h={46} fields={[{ label: "Priority", sub: "2 bytes · e.g. 24576", w: 170, color: D.violet, strong: true }, { label: "Bridge MAC", sub: "6 bytes · e.g. 00:00:5E:00:53:01", w: 350, color: D.eth }]} />
      <text x={60} y={104} fill={D.text} fontSize={10.5} fontWeight={700}>
        Compared as one number: the priority dominates; the MAC only decides between equal priorities.
      </text>
      <text x={60} y={124} fill={D.muted} fontSize={10}>
        Some implementations fold a VLAN or instance number into the priority field (a &quot;system ID extension&quot;).
      </text>
      <text x={60} y={140} fill={D.muted} fontSize={10}>
        This lesson models one spanning tree instance, so plain priority + MAC is enough.
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

export function StpDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="std-bid" eyebrow="Identity" title="The Bridge ID" tone="violet">
        <DiagramFrame caption="Priority and MAC, compared as one value.">
          <BridgeIdDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="std-bpdu" eyebrow="Frame" title="An RST BPDU on the wire" tone="cyan">
        <DiagramFrame caption="IEEE 802.3 + LLC + RST BPDU (Protocol Version 2, BPDU Type 0x02).">
          <BpduDiagram />
        </DiagramFrame>
        <p>
          The Flags byte carries the sending port&apos;s role and its Learning/Forwarding state, plus the Proposal, Agreement and topology-change bits. These are real protocol fields. The decisions they lead to live in each bridge&apos;s state.
        </p>
      </GuideSection>

      <GuideSection id="std-vector" eyebrow="Comparison" title="Priority vectors" tone="ip">
        <DiagramFrame caption="The same ordered comparison chooses the root, Root Ports and Designated ports.">
          <VectorDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="std-roles" eyebrow="Roles" title="What each port is for" tone="warning">
        <DiagramFrame caption="Role says what a port is for; state says what it does with customer data right now.">
          <RolesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="std-states" eyebrow="States" title="Classic STP vs RSTP" tone="cyan">
        <DiagramFrame caption="Different names, one idea: data forwards only in Forwarding.">
          <StatesDiagram />
        </DiagramFrame>
        <p>Classic STP moved a port through Listening and Learning on timers (15 s each by default). RSTP reaches Forwarding far faster on point-to-point links by explicit handshake, and uses Alternate ports as pre-computed backups.</p>
      </GuideSection>

      <GuideSection id="std-sync" eyebrow="Speed" title="Proposal and agreement" tone="success">
        <DiagramFrame caption="Rapid synchronization on point-to-point links.">
          <SyncDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="std-tc" eyebrow="Change" title="Topology change" tone="warning">
        <DiagramFrame caption="The tree changed, so MAC tables must be refreshed.">
          <TcDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="std-edge" eyebrow="Host ports" title="Edge ports" tone="ip">
        <DiagramFrame caption="A convenience for host ports, not a loop-protection switch.">
          <EdgeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="std-compare" eyebrow="Comparison" title="Spanning tree does not add bandwidth" tone="violet">
        <CompareCards
          items={[
            { title: "STP / RSTP", tone: "ethernet", tag: "topology", points: ["Keeps a redundant topology loop-free", "Leaves some links non-forwarding", "Provides failover, not extra capacity"] },
            { title: "Link aggregation (LACP)", tone: "cyan", tag: "one logical link", points: ["Bundles parallel links between the same two devices", "All healthy members can forward", "STP sees the bundle as one path"] },
          ]}
        />
        <Callout tone="cyan" title="Vendor variants">
          Many vendors run one tree per VLAN (PVST-style) or per instance (MSTP). The concepts here — Bridge ID, priority vectors, roles and states — carry over, but this lesson treats standard single-instance RSTP as the model and no vendor flavor as canonical.
        </Callout>
      </GuideSection>

      <GuideSection id="std-workflow" eyebrow="Workflow" title="Troubleshooting a spanning tree" tone="danger">
        <FlowSteps
          steps={[
            { title: "Which bridge is root?", body: "Every bridge should report the same Root ID. Is it the one you intended (priority set on purpose)?", tone: "violet" },
            { title: "Walk each bridge's Root Port", body: "Does each non-root bridge point along the cheapest path you expect?", tone: "ip" },
            { title: "Find the Discarding ports", body: "Every physical loop needs one. A loop with none means something isn't participating.", tone: "warning" },
            { title: "Check participation", body: "RSTP disabled on an inter-switch port, BPDUs filtered, or a mis-set edge port can all remove protection.", tone: "danger" },
            { title: "Watch the symptoms", body: "MAC-move warnings, rising broadcast counters, and topology-change storms point at loops or flapping links.", tone: "cyan" },
          ]}
        />
      </GuideSection>

      <GuideSection id="std-verify" eyebrow="Verification" title="What healthy looks like" tone="success">
        <ChecklistCard tone="success" title="Healthy RSTP" mark="✓" items={["One agreed root; root has no Root Port", "Exactly one Root Port on each non-root bridge", "At least one Alternate/Discarding port on every physical loop", "Stable MAC tables; no repeated topology changes", `BPDUs seen on inter-switch ports (to ${BPDU_DST})`]} />
      </GuideSection>

      <GuideSection id="std-model" eyebrow="Mental model" title="A tree over a mesh" tone="violet">
        <p>
          The cabling is a mesh; the forwarding topology is a tree. RSTP decides which edges of the mesh make up the tree, and keeps the rest ready as replacements. Customer frames only ever see the tree. BPDUs, carried on <Mono>{BPDU_DST}</Mono>, see every edge.
        </p>
      </GuideSection>

      <GuideSection id="std-glossary" eyebrow="Glossary" title="Deep-dive terms" tone="cyan">
        <Glossary
          items={[
            { term: "Priority vector", def: "{Root ID, Root Path Cost, Bridge ID, Port ID} compared in order." },
            { term: "Port ID", def: "Port priority + port number, e.g. 0x8002 = 128.2." },
            { term: "Proposal / Agreement", def: "RSTP handshake that lets a point-to-point port forward quickly." },
            { term: "Topology change", def: "Event that makes bridges flush non-edge MAC entries." },
            { term: "Edge port", def: "Host-facing port that forwards immediately; loses edge status if a BPDU arrives." },
            { term: "Backup port", def: "Backup for a segment the same bridge already serves as Designated." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
