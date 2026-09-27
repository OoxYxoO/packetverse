import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { TPID } from "@/lib/sim-engine/scenarios/vlanFundamentals";

export const VLAN_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vld-size", label: "Frame size with a tag" },
  { id: "vld-tci", label: "TCI bit by bit" },
  { id: "vld-rules", label: "Ingress & egress rules" },
  { id: "vld-chain", label: "Trunks in a chain" },
  { id: "vld-native", label: "Native VLAN (context)" },
  { id: "vld-l3", label: "Inter-VLAN routing (context)" },
  { id: "vld-workflow", label: "Troubleshooting workflow" },
  { id: "vld-glossary", label: "Glossary" },
];

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

function TciDiagram() {
  return (
    <DiagramSvg h={170} label="TCI 16 bits: PCP bits 15 to 13 priority 0 to 7, DEI bit 12, VID bits 11 to 0; VID 0 means priority-tagged, VID 4095 reserved; 1 to 4094 usable">
      <DFieldRow
        x={40}
        y={40}
        h={44}
        fields={[
          { label: "PCP", sub: "bits 15–13", w: 150, color: D.warning },
          { label: "DEI", sub: "bit 12", w: 60, color: D.faint },
          { label: "VID", sub: "bits 11–0", w: 350, color: D.cyan, strong: true },
        ]}
      />
      <text x={115} y={108} textAnchor="middle" fill={D.warning} fontSize={10}>
        priority 0–7 (802.1p)
      </text>
      <text x={220} y={126} textAnchor="middle" fill={D.muted} fontSize={10}>
        drop eligible
      </text>
      <text x={425} y={108} textAnchor="middle" fill={D.cyan} fontSize={10}>
        0 = priority tag only · 4095 reserved · 1–4094 usable
      </text>
      <text x={40} y={24} fill={D.muted} fontSize={10}>
        TPID {TPID} (16 bits) comes first; then this 16-bit TCI
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

function NativeDiagram() {
  return (
    <DiagramSvg h={170} label="Operational context: on many platforms a trunk sends one configured native VLAN untagged; both ends must agree; behaviour and defaults vary by platform">
      <DNode x={120} y={70} label="SW-X" accent={D.eth} w={80} />
      <DNode x={520} y={70} label="SW-Y" accent={D.eth} w={80} />
      <DLink x1={160} y1={60} x2={480} y2={60} color={D.violet} label="VID 10, VID 20 — tagged" />
      <DLink x1={160} y1={80} x2={480} y2={80} color={D.warning} dashed label="native VLAN — untagged" labelDy={18} />
      <DPill x={320} y={138} text="platform-specific · both ends must match" color={D.warning} w={280} />
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

export function VlanDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="vld-size" eyebrow="Sizes" title="What 4 bytes do to a frame" tone="violet">
        <DiagramFrame caption="The tag adds 4 bytes to the header, not to the payload MTU.">
          <SizeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vld-tci" eyebrow="IEEE 802.1Q" title="The TCI, bit by bit" tone="cyan">
        <DiagramFrame caption="12 VID bits allow 4094 usable VLAN IDs.">
          <TciDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vld-rules" eyebrow="Switch behaviour" title="Ingress and egress rules" tone="success">
        <DiagramFrame caption="Classify on ingress, forward within the VLAN, and let the egress port decide tagged or untagged.">
          <RulesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vld-chain" eyebrow="Scale" title="Trunks in a chain" tone="violet">
        <DiagramFrame caption="Tags survive every trunk. Only access ports strip them.">
          <ChainDiagram />
        </DiagramFrame>
        <p>Every trunk along the path must allow the VLAN. One missing entry anywhere is enough to break it, which is exactly the lesson&apos;s incident.</p>
      </GuideSection>

      <GuideSection id="vld-native" eyebrow="Additional operational context" title="Native VLAN" tone="warning">
        <DiagramFrame caption="Not part of the lesson's simulation. Conventions and defaults vary by platform.">
          <NativeDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Platform-dependent">
          Many platforms let one VLAN cross a trunk untagged (the native VLAN). Its default, and whether it is used at all, depends on the vendor and configuration. A mismatch between the two ends can silently join two VLANs. Many designs tag everything on trunks.
        </Callout>
      </GuideSection>

      <GuideSection id="vld-l3" eyebrow="Context" title="Inter-VLAN routing" tone="ip">
        <DiagramFrame caption="Covered in routing lessons. Not simulated here.">
          <L3Diagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vld-workflow" eyebrow="Workflow" title="Troubleshooting a VLAN path" tone="danger">
        <FlowSteps
          steps={[
            { title: "Scope", body: "Which VLANs fail, and which work? A single failing VLAN points at VLAN configuration, not cables.", tone: "cyan" },
            { title: "Access ports", body: "Is each host's port in the VLAN you expect?", tone: "violet" },
            { title: "Trunks", body: "Is the port really a trunk, and is the VLAN in the allowed list on BOTH ends of EVERY trunk?", tone: "warning" },
            { title: "VLAN exists", body: "Is the VLAN defined on every switch in the path?", tone: "ip" },
            { title: "Verify", body: "Check the per-VLAN MAC table, then send traffic and confirm the tag VID on the trunk.", tone: "success" },
          ]}
        />
        <ChecklistCard tone="warning" title="Don't" mark="✕" items={["Bounce a trunk that is carrying other VLANs fine", "Move hosts between VLANs to 'fix' reachability", <>Look for IP routing problems between hosts in the <Mono>same</Mono> VLAN</>]} />
      </GuideSection>

      <GuideSection id="vld-glossary" eyebrow="Glossary" title="Deep-dive terms" tone="violet">
        <FieldTable
          title="Reserved VID values"
          columns={["VID", "Meaning"]}
          rows={[
            ["0", "Priority-tagged frame (no VLAN; the PCP is still used)"],
            ["1–4094", "Usable VLAN IDs"],
            ["4095", "Reserved"],
          ]}
        />
        <Glossary
          items={[
            { term: "PCP", def: "Priority Code Point, 3 bits (IEEE 802.1p class of service)." },
            { term: "DEI", def: "Drop Eligible Indicator, 1 bit." },
            { term: "Native VLAN", def: "A platform-specific VLAN sent untagged on a trunk." },
            { term: "IRB / SVI", def: "A routed interface for a VLAN on a Layer-3 switch." },
            { term: "Q-in-Q", def: "Stacking two 802.1Q-style tags (802.1ad). Beyond this lesson." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
