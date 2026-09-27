import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { HOST_VLAN, TPID, TRUNK_PORT, VLAN_MAC } from "@/lib/sim-engine/scenarios/vlanFundamentals";

export const VLAN_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vl-mission", label: "The mission" },
  { id: "vl-topology", label: "Access and trunk" },
  { id: "vl-journey", label: "Untagged → tagged → untagged" },
  { id: "vl-tag", label: "The 802.1Q tag" },
  { id: "vl-fdb", label: "VLAN-scoped FDB" },
  { id: "vl-broadcast", label: "Broadcast isolation" },
  { id: "vl-intervlan", label: "Between VLANs" },
  { id: "vl-incident", label: "Allowed-VLAN incident" },
  { id: "vl-verify", label: "Verification" },
  { id: "vl-model", label: "Mental model" },
  { id: "vl-glossary", label: "Glossary" },
  { id: "vl-recap", label: "Recap" },
];

const V10 = D.cyan;
const V20 = D.violet;
const vc = (v: number) => (v === 10 ? V10 : V20);
const short = (m: string) => `…${m.slice(-5)}`;

function Topo({ highlight }: { highlight?: { lanes?: "both" | "20only"; bcast?: boolean } }) {
  const lanes = highlight?.lanes ?? "both";
  const hosts = [
    { id: "HOST-A", x: 70, y: 50 },
    { id: "HOST-C", x: 70, y: 190 },
    { id: "HOST-B", x: 570, y: 50 },
    { id: "HOST-D", x: 570, y: 190 },
  ] as const;
  const sw = { SW1: { x: 220, y: 120 }, SW2: { x: 420, y: 120 } };
  return (
    <g>
      {hosts.map((h) => {
        const s = h.id === "HOST-A" || h.id === "HOST-C" ? sw.SW1 : sw.SW2;
        const v = HOST_VLAN[h.id];
        const reached = highlight?.bcast && h.id !== "HOST-A" ? h.id === "HOST-B" : undefined;
        const sub = highlight?.bcast && h.id === "HOST-A" ? "sender" : reached === undefined ? short(VLAN_MAC[h.id]) : reached ? "receives" : "never sees it";
        return (
          <g key={h.id}>
            <DLink x1={h.x + (h.x < 300 ? 50 : -50)} y1={h.y} x2={s.x + (h.x < 300 ? -40 : 40)} y2={s.y + (h.y < 120 ? -12 : 12)} color={vc(v)} label={`VLAN ${v}`} labelDy={h.y < 120 ? -8 : 16} />
            <DNode x={h.x} y={h.y} label={h.id} sub={sub} accent={reached === false ? D.faint : vc(v)} />
          </g>
        );
      })}
      <DNode x={sw.SW1.x} y={sw.SW1.y} label="SW1" accent={D.eth} w={80} />
      <DNode x={sw.SW2.x} y={sw.SW2.y} label="SW2" accent={D.eth} w={80} />
      <line x1={262} y1={113} x2={378} y2={113} stroke={lanes === "20only" ? D.danger : V10} strokeWidth={3} strokeDasharray={lanes === "20only" ? "5 4" : undefined} />
      <line x1={262} y1={127} x2={378} y2={127} stroke={V20} strokeWidth={3} />
      <text x={320} y={100} textAnchor="middle" fill={D.text} fontSize={10} fontWeight={700}>
        {TRUNK_PORT} trunk
      </text>
      <text x={320} y={148} textAnchor="middle" fill={lanes === "20only" ? D.danger : D.muted} fontSize={9.5}>
        {lanes === "20only" ? "SW1 allows 20 only" : "allowed 10, 20"}
      </text>
    </g>
  );
}

function TopologyDiagram() {
  return (
    <DiagramSvg h={240} label={`HOST-A and HOST-C on SW1, HOST-B and HOST-D on SW2; VLAN 10 is A and B, VLAN 20 is C and D; SW1 ${TRUNK_PORT} to SW2 ${TRUNK_PORT} is an 802.1Q trunk allowing 10 and 20`}>
      <Topo />
      <text x={20} y={232} fill={D.muted} fontSize={10}>
        Access links carry one VLAN, untagged. The trunk carries both, tagged (the two coloured lanes are one cable).
      </text>
    </DiagramSvg>
  );
}

function JourneyDiagram() {
  const seg = (y: number, title: string, tagged: boolean, color: string) => (
    <g>
      <text x={20} y={y - 7} fill={color} fontSize={10} fontWeight={700}>
        {title}
      </text>
      <DFieldRow
        x={20}
        y={y}
        h={34}
        fields={[
          { label: "Dst MAC", w: 100 },
          { label: "Src MAC", w: 100 },
          ...(tagged ? [{ label: "802.1Q VID 10", w: 120, color: D.violet, strong: true }] : []),
          { label: "EtherType", w: 90 },
          { label: "Payload", w: 110, color: D.ip },
          { label: "FCS", w: 60 },
        ]}
      />
    </g>
  );
  return (
    <DiagramSvg h={210} label="HOST-A to SW1: untagged frame. SW1 to SW2 on the trunk: 802.1Q tag with VID 10 inserted after the source MAC. SW2 to HOST-B: untagged again">
      {seg(28, "HOST-A → SW1 (access, VLAN 10) — untagged", false, V10)}
      {seg(96, `SW1 → SW2 (${TRUNK_PORT} trunk) — tag added, FCS recomputed`, true, D.violet)}
      {seg(164, "SW2 → HOST-B (access, VLAN 10) — tag removed, FCS recomputed", false, V10)}
    </DiagramSvg>
  );
}

function TagDiagram() {
  return (
    <DiagramSvg h={210} label={`802.1Q tagged frame: Destination MAC, Source MAC, TPID ${TPID}, TCI with PCP 3 bits, DEI 1 bit, VID 12 bits, then the original EtherType, payload and FCS`}>
      <DFieldRow
        x={20}
        y={30}
        fields={[
          { label: "Dst MAC", sub: "6 B", w: 90 },
          { label: "Src MAC", sub: "6 B", w: 90 },
          { label: "TPID", sub: TPID, w: 90, color: D.violet, strong: true },
          { label: "TCI", sub: "2 B", w: 90, color: D.violet, strong: true },
          { label: "EtherType", sub: "0x0800", w: 90 },
          { label: "Payload", w: 90, color: D.ip },
          { label: "FCS", sub: "4 B", w: 60 },
        ]}
      />
      <text x={290} y={96} textAnchor="middle" fill={D.violet} fontSize={10} fontWeight={700}>
        the 4-byte tag, inserted here
      </text>
      <DArrow x1={335} y1={104} x2={335} y2={126} color={D.violet} />
      <text x={192} y={155} textAnchor="end" fill={D.violet} fontSize={10} fontWeight={700}>
        TCI (16 bits) =
      </text>
      <DFieldRow
        x={200}
        y={130}
        h={40}
        fields={[
          { label: "PCP", sub: "3 bits", w: 70, color: D.warning },
          { label: "DEI", sub: "1 bit", w: 50, color: D.faint },
          { label: "VID = 10", sub: "12 bits", w: 150, color: D.cyan, strong: true },
        ]}
      />
      <text x={20} y={196} fill={D.muted} fontSize={10}>
        The original EtherType is still there. TPID {TPID} just tells the receiver that a tag follows.
      </text>
    </DiagramSvg>
  );
}

function FdbDiagram() {
  return (
    <DiagramSvg h={170} label={`SW1 FDB keyed by VLAN and MAC: VLAN 10 HOST-A ge-0/0/1, VLAN 10 HOST-B ${TRUNK_PORT}, VLAN 20 HOST-C ge-0/0/2`}>
      <DTable
        x={20}
        y={16}
        title="SW1 FDB"
        cols={[
          { label: "VLAN", w: 60 },
          { label: "MAC", w: 160 },
          { label: "PORT", w: 100 },
        ]}
        rows={[
          ["10", VLAN_MAC["HOST-A"], "ge-0/0/1"],
          ["10", VLAN_MAC["HOST-B"], TRUNK_PORT],
          ["20", VLAN_MAC["HOST-C"], "ge-0/0/2"],
        ]}
        highlight={{ row: 2, color: V20 }}
      />
      <text x={370} y={50} fill={D.text} fontSize={10.5} fontWeight={700}>
        Lookup key = (VLAN, MAC)
      </text>
      <text x={370} y={70} fill={D.muted} fontSize={10}>
        A VLAN 20 frame can only match VLAN 20
      </text>
      <text x={370} y={86} fill={D.muted} fontSize={10}>
        rows, and leave through VLAN 20 ports.
      </text>
      <text x={370} y={112} fill={D.muted} fontSize={10}>
        The trunk appears in both VLANs&apos; views.
      </text>
    </DiagramSvg>
  );
}

function BroadcastDiagram() {
  return (
    <DiagramSvg h={240} label="HOST-A's VLAN 10 broadcast crosses the trunk tagged VID 10 and reaches only HOST-B; HOST-C and HOST-D never see it">
      <Topo highlight={{ bcast: true }} />
      <DPill x={320} y={60} text="FF:FF:FF:FF:FF:FF · VID 10" color={V10} />
      <text x={20} y={232} fill={D.muted} fontSize={10}>
        HOST-C shares SW1 and HOST-D shares SW2, but neither shares VLAN 10.
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={240} label={`Incident: SW1 ${TRUNK_PORT} allowed list is 20 only; VLAN 10 is filtered on the trunk while VLAN 20 keeps crossing; the link is up`}>
      <Topo highlight={{ lanes: "20only" }} />
      <DPill x={320} y={74} text="VLAN 10: no egress → drop" color={D.danger} w={170} />
      <DPill x={420} y={180} text="VLAN 20: fine" color={V20} w={110} />
      <text x={20} y={232} fill={D.muted} fontSize={10}>
        Link up · both switches up · host ports up · only one VLAN filtered.
      </text>
    </DiagramSvg>
  );
}

export function VlanLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="vl-mission" eyebrow="This lesson" title="Two LANs on one set of switches" tone="violet">
        <p>A VLAN is a separate Layer-2 broadcast domain carved out of shared switches. You&apos;ll watch the switches decide which VLAN each frame belongs to, carry both VLANs over one trunk, and keep their forwarding separate.</p>
        <Callout tone="violet" title="Where VLAN information lives">
          Hosts send ordinary frames. Access ports assign the VLAN. Only the trunk carries it inside the frame, as an 802.1Q tag.
        </Callout>
      </GuideSection>

      <GuideSection id="vl-topology" eyebrow="Topology" title="Access ports and one trunk" tone="cyan">
        <DiagramFrame caption="Each colour is one VLAN: VLAN 10 (cyan) and VLAN 20 (violet).">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vl-journey" eyebrow="Frame journey" title="Untagged → tagged → untagged" tone="cyan">
        <DiagramFrame caption="The same HOST-A → HOST-B frame on each of its three links.">
          <JourneyDiagram />
        </DiagramFrame>
        <p>SW1 classifies the untagged frame into VLAN 10 from its ingress port, adds the tag on trunk egress, and SW2 removes it on access egress. Adding or removing the tag changes the frame&apos;s bytes, so the FCS is recomputed each time.</p>
      </GuideSection>

      <GuideSection id="vl-tag" eyebrow="IEEE 802.1Q" title="Inside the tag" tone="violet">
        <DiagramFrame caption="The tag goes after the source MAC and before the original EtherType. It doesn't replace the EtherType.">
          <TagDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vl-fdb" eyebrow="Forwarding state" title="A separate MAC table view per VLAN" tone="cyan">
        <DiagramFrame caption="Every FDB entry is a (VLAN, MAC) pair.">
          <FdbDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vl-broadcast" eyebrow="Isolation" title="A broadcast stays in its VLAN" tone="warning">
        <DiagramFrame caption="Flooding only uses ports that are members of the frame's VLAN.">
          <BroadcastDiagram />
        </DiagramFrame>
        <p>This is Layer-2 isolation. It comes from switch VLAN membership, not from IP subnets or routing.</p>
      </GuideSection>

      <GuideSection id="vl-intervlan" eyebrow="Limits" title="Crossing between VLANs needs Layer 3" tone="ip">
        <p>No amount of switching moves a frame from VLAN 10 into VLAN 20. HOST-A reaching HOST-C needs a router, or a Layer-3 switch/IRB interface, that routes between the two VLANs. Routing lessons cover that; it isn&apos;t simulated here.</p>
      </GuideSection>

      <GuideSection id="vl-incident" eyebrow="Troubleshooting" title="One VLAN missing from the trunk" tone="danger">
        <DiagramFrame caption="The trunk filters VLAN by VLAN. A problem with one VLAN is almost never physical.">
          <IncidentDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Evidence", tone: "danger", tag: "facts", points: ["VLAN 10 fails across the trunk", "VLAN 20 crosses the same trunk", "Link, switches and host ports are up"] },
            { title: "Therefore not", tone: "success", tag: "ruled out", points: ["A physical failure (it would stop both VLANs)", "Spanning Tree blocking (it would stop both VLANs)", "IP routing (A and B are in the same VLAN)"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-verify" eyebrow="Verification" title="Prove the fix" tone="success">
        <ChecklistCard tone="success" title="After allowing VLAN 10" mark="✓" items={[<>SW1 {TRUNK_PORT} allowed list: 10, 20</>, "HOST-A → HOST-B crosses the trunk tagged VID 10", "HOST-B receives it untagged", "HOST-C ↔ HOST-D was never interrupted"]} />
      </GuideSection>

      <GuideSection id="vl-model" eyebrow="Mental model" title="Coloured lanes on one road" tone="cyan">
        <p>Each VLAN is a coloured lane. Access ports are single-colour on-ramps. The trunk is a multi-lane road, and the tag is the paint on the car that says which lane it is in. The allowed list decides which lanes a trunk has. Remove a lane, and that colour&apos;s traffic can&apos;t use the road, even though the road is open.</p>
      </GuideSection>

      <GuideSection id="vl-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "Access port", def: "Carries one VLAN, untagged, to an end host." },
            { term: "Trunk port", def: "Carries several VLANs, identified by 802.1Q tags." },
            { term: "VID", def: "12-bit VLAN ID in the tag. 1–4094 are usable." },
            { term: "TPID", def: `${TPID}. Marks the frame as 802.1Q-tagged.` },
            { term: "TCI", def: "Tag Control Information: PCP (3 bits), DEI (1 bit), VID (12 bits)." },
            { term: "Allowed VLAN list", def: "The VLANs a trunk will carry. Others are filtered." },
            { term: "VLAN-scoped FDB", def: "MAC learning and lookup per (VLAN, MAC)." },
            { term: "Broadcast domain", def: "The set of ports a broadcast reaches. One per VLAN." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard tone="cyan" title="VLANs & Trunking" mark="→" items={["The switch classifies untagged frames by ingress access port", <>Trunk frames carry TPID <Mono>{TPID}</Mono> plus a VID, before the original EtherType</>, "The tag is added on trunk egress and removed on access egress", "The FDB is keyed by (VLAN, MAC)", "Broadcasts stay inside their VLAN; crossing VLANs needs Layer 3", "Allowed-list faults break one VLAN while others keep working"]} />
      </GuideSection>
    </div>
  );
}
