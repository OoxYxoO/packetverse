import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BROADCAST_MAC, ETH_MAC, FDB_AGING_SEC } from "@/lib/sim-engine/scenarios/ethernetSwitching";

export const ETH_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ethd-frame", label: "Frame anatomy" },
  { id: "ethd-mac", label: "MAC address structure" },
  { id: "ethd-decision", label: "The bridge decision" },
  { id: "ethd-multi", label: "Learning across switches" },
  { id: "ethd-aging", label: "Aging in time" },
  { id: "ethd-router", label: "Switch vs router" },
  { id: "ethd-troubleshoot", label: "Troubleshooting workflow" },
  { id: "ethd-glossary", label: "Glossary" },
];

function FrameDiagram() {
  return (
    <DiagramSvg h={170} label="Ethernet II frame: Destination MAC 6 bytes, Source MAC 6 bytes, EtherType 2 bytes, Payload 46 to 1500 bytes, FCS 4 bytes; preamble and SFD precede it on the wire">
      <DFieldRow
        x={20}
        y={40}
        fields={[
          { label: "Preamble+SFD", sub: "8 B (PHY)", w: 90, color: D.faint },
          { label: "Destination", sub: "6 B", w: 100, color: D.cyan, strong: true },
          { label: "Source", sub: "6 B", w: 100, color: D.warning, strong: true },
          { label: "EtherType", sub: "2 B", w: 80, color: D.violet },
          { label: "Payload", sub: "46–1500 B", w: 150, color: D.ip },
          { label: "FCS", sub: "4 B", w: 70, color: D.eth },
        ]}
      />
      <DArrow x1={160} y1={120} x2={160} y2={92} color={D.cyan} />
      <text x={160} y={136} textAnchor="middle" fill={D.cyan} fontSize={10}>
        forwarding lookup
      </text>
      <DArrow x1={260} y1={120} x2={260} y2={92} color={D.warning} />
      <text x={260} y={136} textAnchor="middle" fill={D.warning} fontSize={10}>
        source learning
      </text>
      <text x={20} y={24} fill={D.muted} fontSize={10}>
        header = 14 bytes · minimum frame 64 bytes (Dst…FCS) · a switch leaves every field unchanged
      </text>
      <text x={575} y={136} textAnchor="middle" fill={D.muted} fontSize={10}>
        CRC-32 check
      </text>
    </DiagramSvg>
  );
}

function MacDiagram() {
  return (
    <DiagramSvg h={190} label={`MAC address ${ETH_MAC["HOST-A"]}: first three octets are the OUI, last three are assigned by the vendor; in the first octet bit 0 is I/G (group) and bit 1 is U/L (locally administered)`}>
      <DFieldRow
        x={80}
        y={30}
        fields={["00", "11", "22", "33", "44", "0A"].map((o, i) => ({ label: o, sub: `octet ${i + 1}`, w: 80, color: i < 3 ? D.violet : D.cyan, strong: i === 0 }))}
      />
      <DLink x1={80} y1={90} x2={320} y2={90} color={D.violet} label="OUI (organisation)" labelDy={16} />
      <DLink x1={320} y1={90} x2={560} y2={90} color={D.cyan} label="vendor-assigned" labelDy={16} />
      <text x={80} y={140} fill={D.text} fontSize={10.5} fontWeight={700}>
        First octet, least-significant bits:
      </text>
      <text x={80} y={158} fill={D.muted} fontSize={10}>
        bit 0 = I/G: 0 individual (unicast), 1 group (multicast / broadcast)
      </text>
      <text x={80} y={174} fill={D.muted} fontSize={10}>
        bit 1 = U/L: 0 universally administered, 1 locally administered · {BROADCAST_MAC} has every bit set
      </text>
    </DiagramSvg>
  );
}

function DecisionDiagram() {
  const box = (x: number, y: number, t: string, c: string, w = 150) => <DNode x={x} y={y} label={t} accent={c} w={w} h={34} />;
  return (
    <DiagramSvg h={350} label="Bridge decision: receive and check FCS, learn source, then if destination is group address flood; else look up; hit on another port forward; hit on ingress port filter; miss flood">
      {box(100, 30, "Receive · FCS OK?", D.eth)}
      {box(100, 90, "Learn SOURCE → port", D.warning)}
      {box(100, 150, "Destination group?", D.violet)}
      {box(330, 150, "Flood (except ingress)", D.arp, 170)}
      {box(100, 210, "FDB lookup", D.cyan)}
      {box(330, 210, "Miss → flood", D.warning, 170)}
      {box(100, 270, "Hit: which port?", D.cyan)}
      {box(330, 270, "Other port → forward", D.success, 170)}
      {box(100, 330, "Ingress port → filter", D.faint, 170)}
      <DArrow x1={100} y1={47} x2={100} y2={72} color={D.muted} />
      <DArrow x1={100} y1={107} x2={100} y2={132} color={D.muted} />
      <DArrow x1={175} y1={150} x2={243} y2={150} color={D.arp} label="yes" />
      <DArrow x1={100} y1={167} x2={100} y2={192} color={D.muted} />
      <text x={110} y={184} fill={D.muted} fontSize={10} fontWeight={700}>
        no
      </text>
      <DArrow x1={175} y1={210} x2={243} y2={210} color={D.warning} label="no entry" />
      <DArrow x1={100} y1={227} x2={100} y2={252} color={D.muted} />
      <DArrow x1={175} y1={270} x2={243} y2={270} color={D.success} label="other port" />
      <DArrow x1={100} y1={287} x2={100} y2={312} color={D.faint} />
      <text x={110} y={304} fill={D.muted} fontSize={10} fontWeight={700}>
        same as ingress
      </text>
      <text x={180} y={30} fill={D.danger} fontSize={10}>
        bad FCS → discarded silently
      </text>
    </DiagramSvg>
  );
}

function MultiSwitchDiagram() {
  return (
    <DiagramSvg h={250} label="Two switches in a row: SW-X learns HOST-2 and HOST-3 both on its uplink port, because many MACs can share one port">
      <DNode x={80} y={60} label="HOST-1" sub="…:01" />
      <DNode x={260} y={110} label="SW-X" accent={D.violet} w={90} />
      <DNode x={460} y={110} label="SW-Y" accent={D.violet} w={90} />
      <DNode x={590} y={50} label="HOST-2" sub="…:02" w={90} />
      <DNode x={590} y={170} label="HOST-3" sub="…:03" w={90} />
      <DLink x1={130} y1={70} x2={215} y2={102} label="p1" />
      <DLink x1={305} y1={110} x2={415} y2={110} label="p9 ↔ p1" />
      <DLink x1={505} y1={100} x2={545} y2={62} />
      <DLink x1={505} y1={120} x2={545} y2={160} />
      <DTable
        x={60}
        y={130}
        title="SW-X FDB"
        cols={[
          { label: "MAC", w: 90 },
          { label: "PORT", w: 70 },
        ]}
        rows={[
          ["…:01", "p1"],
          ["…:02", "p9"],
          ["…:03", "p9"],
        ]}
        highlight={{ row: 1, color: D.cyan }}
      />
      <text x={260} y={190} fill={D.muted} fontSize={10}>
        Many MACs behind one port is normal: SW-X only
      </text>
      <text x={260} y={205} fill={D.muted} fontSize={10}>
        knows the direction, not the final switch.
      </text>
    </DiagramSvg>
  );
}

function AgingDiagram() {
  const x0 = 50;
  const scale = 1.3;
  const px = (t: number) => x0 + t * scale;
  return (
    <DiagramSvg h={170} label={`Aging timeline: an entry learned at 0 s and refreshed at 120 s expires at 420 s if no further frame arrives; aging time ${FDB_AGING_SEC} s`}>
      <line x1={px(0)} y1={80} x2={px(420)} y2={80} stroke={D.line} strokeWidth={2} />
      {[0, 120, 420].map((t) => (
        <g key={t}>
          <line x1={px(t)} y1={72} x2={px(t)} y2={88} stroke={D.muted} />
          <text x={px(t)} y={106} textAnchor="middle" fill={D.muted} fontSize={10} fontFamily="monospace">
            {t} s
          </text>
        </g>
      ))}
      <DPill x={px(0)} y={50} text="learned" color={D.success} />
      <DPill x={px(120)} y={50} text="source frame → timer reset" color={D.cyan} />
      <DPill x={px(420)} y={50} text="expired" color={D.danger} />
      <rect x={px(120)} y={118} width={FDB_AGING_SEC * scale} height={10} rx={5} fill={D.warning} fillOpacity={0.35} />
      <text x={px(120) + (FDB_AGING_SEC * scale) / 2} y={148} textAnchor="middle" fill={D.warning} fontSize={10}>
        {FDB_AGING_SEC} s with no frame from this MAC
      </text>
    </DiagramSvg>
  );
}

function RouterDiagram() {
  return (
    <DiagramSvg h={210} label="A switch forwards the same frame inside one LAN; a router ends the frame, forwards the IP packet between networks, and builds a new frame with new MAC addresses">
      <text x={20} y={22} fill={D.cyan} fontSize={11} fontWeight={800}>
        SWITCH (Layer 2) — same frame in and out
      </text>
      <DNode x={70} y={60} label="HOST" w={80} />
      <DNode x={320} y={60} label="SW" accent={D.violet} w={70} />
      <DNode x={570} y={60} label="HOST" w={80} />
      <DArrow x1={112} y1={60} x2={283} y2={60} label="dst M2 · src M1" />
      <DArrow x1={357} y1={60} x2={528} y2={60} label="dst M2 · src M1 (unchanged)" />
      <text x={20} y={122} fill={D.ip} fontSize={11} fontWeight={800}>
        ROUTER (Layer 3) — new frame per hop, same IP packet
      </text>
      <DNode x={70} y={165} label="HOST" w={80} />
      <DNode x={320} y={165} label="R" accent={D.ip} w={70} />
      <DNode x={570} y={165} label="HOST" w={80} />
      <DArrow x1={112} y1={165} x2={283} y2={165} color={D.ip} label="dst R-left · src M1" />
      <DArrow x1={357} y1={165} x2={528} y2={165} color={D.ip} label="dst M2 · src R-right" />
      <text x={320} y={200} textAnchor="middle" fill={D.muted} fontSize={10}>
        IP source/destination stay the same; TTL decrements (IPv4 lesson)
      </text>
    </DiagramSvg>
  );
}

export function EthernetDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="ethd-frame" eyebrow="IEEE 802.3" title="Ethernet II frame anatomy" tone="ethernet">
        <DiagramFrame caption="The preamble and SFD sync the receiver and are not part of the frame. The FCS covers destination through payload.">
          <FrameDiagram />
        </DiagramFrame>
        <FieldTable
          title="Header fields"
          columns={["Field", "Size", "Meaning"]}
          rows={[
            ["Destination MAC", "6 B", "Who the frame is for. A unicast, multicast or broadcast address"],
            ["Source MAC", "6 B", "The sender's own (individual) MAC. Used for learning"],
            ["EtherType", "2 B", "Payload protocol when ≥ 0x0600 (0x0800 IPv4, 0x0806 ARP, 0x86DD IPv6). Values ≤ 1500 are an 802.3 length instead"],
            ["Payload", "46–1500 B", "Padded to 46 B if shorter; 1500 B is the standard MTU"],
            ["FCS", "4 B", "CRC-32. A frame with a bad FCS is discarded"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ethd-mac" eyebrow="Addressing" title="What a MAC address encodes" tone="violet">
        <DiagramFrame caption="The two low bits of the first octet mark group vs individual and local vs universal administration.">
          <MacDiagram />
        </DiagramFrame>
        <p>
          A source MAC is always an individual address. A switch never learns a group address such as <Mono>{BROADCAST_MAC}</Mono> or a multicast address, because those can never appear as a sender.
        </p>
      </GuideSection>

      <GuideSection id="ethd-decision" eyebrow="IEEE 802.1D / 802.1Q" title="The transparent-bridge decision" tone="cyan">
        <DiagramFrame caption="Every frame takes the same path. Learning always happens before the forwarding decision.">
          <DecisionDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Multicast">
          Without IGMP/MLD snooping, a basic switch floods multicast like broadcast. With snooping, it forwards multicast only to ports with interested receivers. Multicast is outside this lesson.
        </Callout>
      </GuideSection>

      <GuideSection id="ethd-multi" eyebrow="Beyond one switch" title="Learning across a chain of switches" tone="violet">
        <DiagramFrame caption="Each switch learns the direction to a MAC: the port that leads toward it.">
          <MultiSwitchDiagram />
        </DiagramFrame>
        <p>With more than one path between switches, flooding could loop forever, because Ethernet frames have no TTL. Spanning Tree (a later lesson) blocks redundant paths to prevent that.</p>
      </GuideSection>

      <GuideSection id="ethd-aging" eyebrow="Time" title="Aging in detail" tone="warning">
        <DiagramFrame caption={`IEEE 802.1D recommends a ${FDB_AGING_SEC} s default aging time; it is configurable on managed switches.`}>
          <AgingDiagram />
        </DiagramFrame>
        <p>Aging keeps the table small and self-healing. A host that moves silently is still reached once its old entry expires, because frames to it are flooded again. Clearing the entry only speeds that up.</p>
      </GuideSection>

      <GuideSection id="ethd-router" eyebrow="Layers" title="Switch vs router" tone="ip">
        <DiagramFrame caption="The switch never touches the frame. The router replaces the Ethernet header on every hop.">
          <RouterDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ethd-troubleshoot" eyebrow="Workflow" title="Troubleshooting a Layer-2 path" tone="danger">
        <FlowSteps
          steps={[
            { title: "Links", body: "Are both end ports up, with no errors (FCS or CRC counters)?", tone: "cyan" },
            { title: "Addressing", body: "Does the frame carry the destination's real MAC?", tone: "violet" },
            { title: "FDB", body: "Where does the switch think that MAC lives? Is it the port the host is actually on?", tone: "warning" },
            { title: "Freshness", body: "Was the entry learned before a move? Has the host sent anything since?", tone: "danger" },
            { title: "Fix & verify", body: "Clear the stale dynamic entry, generate traffic from the host, then confirm the new entry and known-unicast delivery.", tone: "success" },
          ]}
        />
        <ChecklistCard tone="warning" title="Avoid" mark="✕" items={["Adding static entries to 'fix' a moving host", "Blaming ARP when the frame's destination MAC is already correct", "Replacing cables that show link and no errors"]} />
      </GuideSection>

      <GuideSection id="ethd-glossary" eyebrow="Glossary" title="Deep-dive terms" tone="violet">
        <Glossary
          items={[
            { term: "Transparent bridge", def: "A switch that forwards frames unchanged, invisibly to hosts (IEEE 802.1D)." },
            { term: "OUI", def: "Organisationally Unique Identifier: the first 3 octets of a universal MAC." },
            { term: "I/G bit", def: "Individual/Group bit. Set on multicast and broadcast destinations." },
            { term: "EtherType", def: "2-byte payload type; ≥ 0x0600 means Ethernet II." },
            { term: "Flooding", def: "Sending a frame out every port in the domain except the ingress port." },
            { term: "Filtering", def: "Dropping a frame whose destination is on the port it arrived on." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
