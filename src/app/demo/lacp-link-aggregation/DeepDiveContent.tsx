import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DNode, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LACP_DST, LACP_ETHERTYPE, LAG_NAME } from "@/lib/sim-engine/scenarios/lacpLinkAggregation";
import { LagPair } from "./guideSvg";

export const LACP_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lcd-purpose", label: "Why aggregate" },
  { id: "lcd-frame", label: "LACPDU format" },
  { id: "lcd-ids", label: "System & Port IDs" },
  { id: "lcd-bits", label: "State flags" },
  { id: "lcd-modes", label: "Active / Passive" },
  { id: "lcd-timeout", label: "Short vs long timeout" },
  { id: "lcd-dist", label: "Collection & distribution" },
  { id: "lcd-stp", label: "LAG and STP" },
  { id: "lcd-vlan", label: "LAG and VLANs" },
  { id: "lcd-minlinks", label: "Minimum links" },
  { id: "lcd-workflow", label: "Troubleshooting" },
  { id: "lcd-verify", label: "Verification" },
  { id: "lcd-model", label: "Mental model" },
  { id: "lcd-glossary", label: "Glossary" },
];

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

export function LacpDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="lcd-purpose" eyebrow="IEEE 802.1AX" title="Why aggregate links" tone="ethernet">
        <p>Link aggregation bundles several full-duplex links between the same two systems into one logical link: more total capacity, survival of member failures, and a single interface for everything above it. LACP is the optional negotiation protocol that checks both ends agree before a member carries traffic. Without it, a static bundle trusts configuration alone.</p>
      </GuideSection>

      <GuideSection id="lcd-frame" eyebrow="Frame" title="The LACPDU" tone="cyan">
        <DiagramFrame caption={`Ethernet → ${LACP_DST} · ${LACP_ETHERTYPE} · subtype 0x01 · Actor + Partner TLVs.`}>
          <FrameDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcd-ids" eyebrow="Identities" title="System ID, Port ID and Key" tone="violet">
        <DiagramFrame caption="Priority + value pairs; lower priority is preferred when a decision must be made.">
          <IdsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcd-bits" eyebrow="State" title="The eight state flags" tone="ip">
        <DiagramFrame caption="Carried separately for Actor and Partner in every LACPDU.">
          <BitsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcd-modes" eyebrow="Modes" title="Active and Passive" tone="warning">
        <DiagramFrame caption="At least one side must start talking.">
          <ModesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcd-timeout" eyebrow="Timers" title="Short vs long timeout" tone="cyan">
        <DiagramFrame caption="How fast a silently failed partner is noticed.">
          <TimeoutDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcd-dist" eyebrow="Data plane" title="Collection, distribution and hashing" tone="success">
        <DiagramFrame caption="LACP says which members; the forwarding system says which member per flow.">
          <DistDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcd-stp" eyebrow="With STP" title="LAG and spanning tree" tone="violet">
        <DiagramFrame caption="One logical path to spanning tree.">
          <StpDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="LACP is not an STP replacement">
          LACP only bundles links between the same two devices. Redundant paths between different switches still need spanning tree, or another loop-free design, to stay loop-free.
        </Callout>
      </GuideSection>

      <GuideSection id="lcd-vlan" eyebrow="With VLANs" title="LAG as a trunk" tone="ip">
        <DiagramFrame caption="Trunk settings belong on the logical interface.">
          <VlanDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lcd-minlinks" eyebrow="Configuration" title="Minimum links (optional)" tone="warning">
        <p>
          Some platforms let you require a minimum number of active members (for example &quot;min-links 2&quot;). Below that the whole LAG is taken down, so traffic moves to a different path instead of squeezing onto too little capacity. This lesson configures no minimum, so <Mono>{LAG_NAME}</Mono> stays up on one member.
        </p>
      </GuideSection>

      <GuideSection id="lcd-workflow" eyebrow="Workflow" title="Troubleshooting a bundle" tone="danger">
        <FlowSteps
          steps={[
            { title: "Physical", body: "Are all members up, at the same speed and duplex?", tone: "cyan" },
            { title: "LACP running?", body: "Are LACPDUs sent and received on every member? Is at least one side Active?", tone: "violet" },
            { title: "Consistency", body: "On EACH switch: same key (and trunk/VLAN settings) on every intended member. Across the link: every member reports the same partner system and partner key.", tone: "warning" },
            { title: "State flags", body: "Which members are Synchronized, Collecting and Distributing on both ends?", tone: "ip" },
            { title: "Distribution", body: "Traffic uneven? Check the hash inputs against your traffic mix; one big flow stays on one member.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="lcd-verify" eyebrow="Verification" title="What healthy looks like" tone="success">
        <ChecklistCard tone="success" title="Healthy LAG" mark="✓" items={["Every member: physical up, Actor and Partner state 0x3D (or 0x3F with short timeout)", "Same partner system and partner key on every member", "Consistent local key per switch", "LAG status: all members distributing", "Spanning tree shows the LAG as one port"]} />
      </GuideSection>

      <GuideSection id="lcd-model" eyebrow="Mental model" title="Negotiated lanes" tone="violet">
        <p>
          Think of LACP as two people at either end of a bundle of ropes, confirming rope by rope that each one is tied to the same two posts. Only confirmed ropes take weight. Loads are hung on one rope each: each flow gets one member. If a rope snaps, the loads move to the others.
        </p>
      </GuideSection>

      <GuideSection id="lcd-glossary" eyebrow="Glossary" title="Deep-dive terms" tone="cyan">
        <Glossary
          items={[
            { term: "IEEE 802.1AX", def: "The link aggregation standard (formerly 802.3ad)." },
            { term: "Slow Protocols", def: `Link-local control family at ${LACP_DST} / ${LACP_ETHERTYPE}.` },
            { term: "Aggregator", def: "The logical interface members attach to." },
            { term: "Defaulted", def: "No partner info received — using defaults." },
            { term: "Expired", def: "Partner info aged out; the member drops out." },
            { term: "Min links", def: "Optional rule taking a LAG down below N members." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
