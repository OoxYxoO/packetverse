import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { HOST_VLAN, TPID, TRUNK_PORT, VLAN_MAC } from "@/lib/sim-engine/scenarios/vlanFundamentals";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { vlApply, vlClone, vlTicket, vlTicketState, vlWarm, type VlState } from "@/lib/sim-engine/scenarios/vlanNet";
import { vlSwitchSets, type VlCliApi } from "./vlan-lab/vlCli";

export const VLAN_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "vl-mission", label: "What this lesson teaches" },
  { id: "vl-network", label: "The network of this lesson" },
  { id: "vl-ideas", label: "Three ideas you need" },
  { id: "vl-walk", label: "What you will watch" },
  { id: "vl-flat", label: "One flat LAN for everyone" },
  { id: "vl-access", label: "The access port decides" },
  { id: "vl-trunk", label: "Across the floors: the trunk" },
  { id: "vl-inside", label: "Inside one VLAN" },
  { id: "vl-between", label: "Between VLANs: a router" },
  { id: "vl-verify", label: "What working looks like" },
  { id: "vl-incident", label: "The incident" },
  { id: "vl-investigate", label: "Follow VLAN 10, link by link" },
  { id: "vl-repair", label: "Repair and prove it" },
  { id: "vl-other", label: "Other ways VLANs break" },
  { id: "vl-model", label: "Mental model" },
  { id: "vl-glossary", label: "Glossary" },
  { id: "vl-recap", label: "Recap" },
  { id: "vl-practice", label: "Practice it" },
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
        {lanes === "20only" ? "SW1 allows 1, 20 only" : "tagged 10, 20"}
      </text>
    </g>
  );
}


export function TopologyDiagram() {
  return (
    <DiagramSvg h={240} label={`HOST-A and HOST-C on SW1, HOST-B and HOST-D on SW2; VLAN 10 is A and B, VLAN 20 is C and D; SW1 ${TRUNK_PORT} to SW2 ${TRUNK_PORT} is an 802.1Q trunk allowing 10 and 20`}>
      <Topo />
      <text x={20} y={232} fill={D.muted} fontSize={10}>
        Access links carry one VLAN, untagged. The trunk carries both, tagged (the two colored lanes are one cable).
      </text>
    </DiagramSvg>
  );
}


export function JourneyDiagram() {
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


export function TagDiagram() {
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


export function FdbDiagram() {
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


export function BroadcastDiagram() {
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


export function IncidentDiagram() {
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


export function RouterOnAStickDiagram() {
  return (
    <DiagramSvg h={250} label="R1 connected to SW2 by one trunk carrying VLAN 10 and VLAN 20. Subinterface .10 accepts VID 10 and owns 192.168.10.1; subinterface .20 accepts VID 20 and owns 192.168.20.1. HOST-A's ping to HOST-C goes down to R1 tagged VID 10 and comes back up tagged VID 20 with TTL 63">
      <DNode x={110} y={60} label="HOST-A" sub="VLAN 10 · .10.11" accent={V10} />
      <DNode x={110} y={190} label="HOST-C" sub="VLAN 20 · .20.13" accent={V20} />
      <DNode x={300} y={125} label="SW1" accent={D.eth} w={80} />
      <DNode x={470} y={125} label="SW2" accent={D.eth} w={80} />
      <DNode x={470} y={222} label="R1" sub=".10 = VID 10 · .20 = VID 20" accent={D.warning} w={150} />
      <DLink x1={160} y1={66} x2={260} y2={116} color={V10} />
      <DLink x1={160} y1={184} x2={260} y2={134} color={V20} />
      <line x1={342} y1={119} x2={428} y2={119} stroke={V10} strokeWidth={3} />
      <line x1={342} y1={131} x2={428} y2={131} stroke={V20} strokeWidth={3} />
      <line x1={464} y1={148} x2={464} y2={200} stroke={V10} strokeWidth={3} />
      <line x1={476} y1={148} x2={476} y2={200} stroke={V20} strokeWidth={3} />
      <DPill x={385} y={100} text="① VID 10 →" color={V10} w={86} />
      <DPill x={410} y={176} text="② VID 10 ↓" color={V10} w={86} />
      <DPill x={548} y={176} text="③ VID 20 ↑ TTL 63" color={V20} w={130} />
      <DPill x={385} y={152} text="④ ← VID 20" color={V20} w={86} />
      <text x={20} y={242} fill={D.muted} fontSize={10}>
        One cable to R1, two subinterfaces. The ping crosses SW1↔SW2 twice: once per VLAN.
      </text>
    </DiagramSvg>
  );
}


export function NativeDiagram() {
  return (
    <DiagramSvg h={190} label="Native VLAN mismatch: SW1 uses native VLAN 10 and sends HOST-A's frame untagged; SW2 uses native VLAN 1 and puts the untagged frame into VLAN 1, where HOST-B is not">
      <DNode x={110} y={70} label="SW1" sub="native 10" accent={D.eth} w={100} />
      <DNode x={530} y={70} label="SW2" sub="native 1" accent={D.eth} w={100} />
      <DArrow x1={165} y1={70} x2={475} y2={70} color={D.danger} label="HOST-A's frame · NO tag" />
      <DPill x={320} y={118} text="SW2: untagged → my native VLAN 1" color={D.danger} w={240} />
      <text x={20} y={160} fill={D.muted} fontSize={10}>
        SW2 learns HOST-A in VLAN 1 and floods it in VLAN 1. HOST-B (VLAN 10) never hears it. Nothing is down, nothing is dropped:
      </text>
      <text x={20} y={176} fill={D.muted} fontSize={10}>
        the frame just changed VLAN. Cisco CDP logs NATIVE_VLAN_MISMATCH; Junos has no equivalent warning.
      </text>
    </DiagramSvg>
  );
}


export function FlatDiagram() {
  const hosts = [
    { id: "HOST-A", x: 70, y: 50, team: "Sales" },
    { id: "HOST-C", x: 70, y: 190, team: "Engineering" },
    { id: "HOST-B", x: 570, y: 50, team: "Sales" },
    { id: "HOST-D", x: 570, y: 190, team: "Engineering" },
  ] as const;
  const sw = { SW1: { x: 220, y: 120 }, SW2: { x: 420, y: 120 } };
  return (
    <DiagramSvg h={240} label="Before VLANs: HOST-A's ARP broadcast is flooded by SW1 and SW2 to every host, Sales and Engineering alike">
      {hosts.map((h) => {
        const s = h.x < 300 ? sw.SW1 : sw.SW2;
        return (
          <g key={h.id}>
            <DLink x1={h.x + (h.x < 300 ? 50 : -50)} y1={h.y} x2={s.x + (h.x < 300 ? -40 : 40)} y2={s.y + (h.y < 120 ? -12 : 12)} color={D.danger} />
            <DNode x={h.x} y={h.y} label={h.id} sub={h.id === "HOST-A" ? "sender" : `${h.team} · receives`} accent={h.id === "HOST-A" ? D.cyan : D.danger} />
          </g>
        );
      })}
      <DNode x={sw.SW1.x} y={sw.SW1.y} label="SW1" accent={D.eth} w={80} />
      <DNode x={sw.SW2.x} y={sw.SW2.y} label="SW2" accent={D.eth} w={80} />
      <line x1={262} y1={120} x2={378} y2={120} stroke={D.danger} strokeWidth={3} />
      <DPill x={320} y={92} text="FF:FF:FF:FF:FF:FF" color={D.danger} w={140} />
      <text x={20} y={232} fill={D.muted} fontSize={10}>
        One broadcast domain: every flood of one team lands on the other team&apos;s machines.
      </text>
    </DiagramSvg>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the VLAN Lab" onPractice={openLab}>
      Same network plus R1, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

/** The lab's own command sets, run against lab states: what this page shows is what the VLAN Lab prints. */
function lessonCli(s: VlState, dev: "SW1" | "SW2", vendor: CliVendor, command: string) {
  const api: VlCliApi = { view: s, act: () => s, ios: { SW1: { kind: "exec" }, SW2: { kind: "exec" }, R1: { kind: "exec" } }, setIos: () => undefined, junosEdit: { SW1: false, SW2: false, R1: false }, setJunosEdit: () => undefined, cand: { sw: vlClone(s.cfg.sw), r1: vlClone(s.cfg.r1) }, setCand: () => undefined };
  return runGuideCli(vlSwitchSets(api, dev)[vendor], command);
}
const HEALTHY = vlWarm();
const BROKEN = vlApply(vlTicketState("allowed", 1), { type: "traffic", sends: vlTicket("allowed").repro });

export function VlanLessonGuideContent() {
  const trunkOk = lessonCli(HEALTHY, "SW1", "cisco", "show interfaces trunk");
  const trunkBad = lessonCli(BROKEN, "SW1", "cisco", "show interfaces trunk");
  const allowedRows = /Gi1\/0\/24|Port/;
  return (
    <div className="space-y-12">
      <GuideSection id="vl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="violet">
        <p>
          An office has two teams on two floors. Sales (HOST-A on floor 1, HOST-B on floor 2) and Engineering (HOST-C on floor 1, HOST-D on floor 2) share the same two switches, SW1 and SW2, joined by one cable. The company wants the teams kept apart (their broadcasts, their traffic, their mistakes) without buying a second set of switches.
        </p>
        <p>
          This lesson shows how <strong>VLANs</strong> do that: you watch frames get their VLAN, cross the trunk tagged, stay inside their VLAN, and need a router to cross between VLANs. Then one VLAN stops crossing the trunk, and you find out why, fix it, and prove it.
        </p>
        <ChecklistCard
          tone="violet"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "say which VLAN each host is in, and who decided it",
            "explain what the trunk between the floors carries, and where the 802.1Q tag exists",
            "predict where a broadcast goes when two VLANs share the switches",
            "explain why HOST-A needs a router to reach HOST-C",
            "find and repair the trunk fault of the incident, and prove VLAN 10 crosses again",
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="The same hardware, two LANs. VLAN 10 is cyan, VLAN 20 violet; the trunk between the floors carries both.">
          <TopologyDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who is where"
          columns={["Host", "Switch port", "VLAN", "Address"]}
          rows={[
            ["HOST-A (Sales)", "SW1 ge-0/0/1", "10", "192.168.10.11"],
            ["HOST-B (Sales)", "SW2 ge-0/0/1", "10", "192.168.10.12"],
            ["HOST-C (Engineering)", "SW1 ge-0/0/2", "20", "192.168.20.13"],
            ["HOST-D (Engineering)", "SW2 ge-0/0/2", "20", "192.168.20.14"],
          ]}
        />
        <p>
          The cable between the floors is <Mono>{TRUNK_PORT}</Mono> on both switches, an 802.1Q trunk that carries VLANs 10 and 20. In the VLAN Lab, SW2 has a second trunk, <Mono>ge-0/0/23</Mono>, to the router R1, the gateway of both VLANs (192.168.10.1 and 192.168.20.1). The lab&apos;s Cisco switches name the same ports Gi1/0/1, Gi1/0/2 and Gi1/0/24.
        </p>
      </GuideSection>

      <GuideSection id="vl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "The access port decides the VLAN", body: "HOST-A sends an ordinary frame. SW1 ge-0/0/1 is an access port in VLAN 10, so the frame is in VLAN 10. The host never knows.", tone: "cyan" },
            { title: "Only the trunk carries the VLAN in the frame", body: `On ${TRUNK_PORT}, SW1 adds an 802.1Q tag with VID 10 so SW2 knows which VLAN the frame is in. SW2 removes it before HOST-B.`, tone: "violet" },
            { title: "Only a router crosses VLANs", body: "VLAN 10 and VLAN 20 are separate LANs. HOST-A reaches HOST-C only through its gateway.", tone: "ip" },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "VLAN 10 unicast", body: "HOST-A → HOST-B: classified into VLAN 10 at SW1, tagged VID 10 across the trunk, untagged at SW2.", tone: "cyan" },
            { title: "The reply", body: "HOST-B answers, as known unicast in VLAN 10 on both switches.", tone: "violet" },
            { title: "VLAN 20 on the same hardware", body: "HOST-C → HOST-D crosses the same cable tagged VID 20. The two VLANs never mix.", tone: "ip" },
            { title: "Broadcast isolation", body: "HOST-A's broadcast reaches HOST-B only. HOST-C, one port away on SW1, never sees it.", tone: "warning" },
            { title: "Between VLANs", body: "Switching alone can't take HOST-A's frame into VLAN 20: that needs a router.", tone: "danger" },
            { title: "The incident", body: "VLAN 10 stops crossing the trunk while VLAN 20 keeps working. You find out why and fix it.", tone: "success" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on this network, in the same order.</p>
      </GuideSection>

      <GuideSection id="vl-flat" eyebrow="The problem" title="One flat LAN for everyone" tone="danger">
        <p>Without VLANs, SW1 and SW2 behave as you saw in Switching: they flood broadcasts out of every port. Every host on both switches is in one broadcast domain, so HOST-A&apos;s ARP request lands on Engineering&apos;s machines too, and nothing separates the two teams.</p>
        <DiagramFrame caption="Without VLANs, HOST-A's ARP request reaches all three other hosts, whichever team they belong to.">
          <FlatDiagram />
        </DiagramFrame>
        <p>With VLANs, Sales becomes VLAN 10 (192.168.10.0/24) and Engineering VLAN 20 (192.168.20.0/24). The switches keep two separate LANs on the same hardware: a frame in VLAN 10 is only ever forwarded to VLAN 10 ports.</p>
      </GuideSection>

      <GuideSection id="vl-access" eyebrow="Access ports" title="The access port decides the VLAN" tone="cyan">
        <p>
          HOST-A sends an ordinary, untagged frame. SW1 receives it on ge-0/0/1, an access port in VLAN 10, so the frame is in VLAN 10. That is the first decision for every frame, before the MAC table is even consulted. The host is not configured for VLANs at all: it only has an address and a gateway in its VLAN&apos;s subnet.
        </p>
        <Callout tone="violet" title="So moving a host means two changes" icon="→">
          Moving HOST-D into Sales needs the switch port in VLAN 10 <em>and</em> a Sales address on HOST-D. Change only the port, and HOST-D sends Engineering-addressed frames into the Sales LAN, where nobody answers them.
        </Callout>
      </GuideSection>

      <GuideSection id="vl-trunk" eyebrow="The trunk" title="Across the floors: the trunk and the tag" tone="violet">
        <p>
          HOST-B is behind the cable between the floors. That cable carries both VLANs, so the port alone can&apos;t tell SW2 which VLAN a frame belongs to. On the trunk, SW1 inserts a 4-byte 802.1Q tag after the source MAC, with the VLAN ID 10. SW2 reads it, delivers the frame among its VLAN 10 ports, and removes the tag before HOST-B. Hosts never see a tag.
        </p>
        <DiagramFrame caption="The same HOST-A → HOST-B frame on each of its three links: untagged, tagged VID 10 on the trunk, untagged again.">
          <JourneyDiagram />
        </DiagramFrame>
        <p>A trunk carries only the VLANs it <strong>allows</strong>, at each end. Keep that in mind: it is the key to the incident.</p>
      </GuideSection>

      <GuideSection id="vl-inside" eyebrow="Inside a VLAN" title="Inside one VLAN: switching as usual" tone="warning">
        <p>HOST-A&apos;s ARP request is flooded to VLAN 10 ports only, on both switches; on the trunk it travels tagged VID 10. HOST-C, one port away on SW1, never sees it. HOST-B answers, and both switches learn the two hosts in VLAN 10. From then on HOST-A → HOST-B is known unicast. No router touches it, so the ping arrives with <strong>TTL 64</strong>.</p>
        <DiagramFrame caption="Flooding only uses ports that are members of the frame's VLAN.">
          <BroadcastDiagram />
        </DiagramFrame>
        <DiagramFrame caption="SW1's MAC table is split by VLAN: a VLAN 20 frame can only match VLAN 20 entries.">
          <FdbDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="vl-between" eyebrow="Between VLANs" title="Between VLANs: a router is required" tone="ip">
        <p>HOST-A → HOST-C is another subnet, so HOST-A sends the packet to its gateway, 192.168.10.1. In the lab that is R1, cabled to SW2 by one trunk with one subinterface per VLAN. The packet goes down to R1 tagged VID 10, R1 routes it (new frame, TTL 63) and sends it back up tagged VID 20 to HOST-C. That round trip is the hairpin.</p>
        <DiagramFrame caption="One cable to R1, two subinterfaces. The ping crosses SW1↔SW2 twice: once per VLAN.">
          <RouterOnAStickDiagram />
        </DiagramFrame>
        <Callout tone="success" title="Two numbers tell you which case you are in" icon="✓">
          TTL 64 at the receiver: same VLAN, switched only. TTL 63: another VLAN, routed once.
        </Callout>
      </GuideSection>

      <GuideSection id="vl-verify" eyebrow="Verification" title="What working looks like on the switches" tone="success">
        <p>Each idea of this lesson has one place on the switches that proves it. The commands are only the way to ask; what matters is what each answer proves.</p>
        <FieldTable
          title="Read the lesson on the switch"
          columns={["Question", "Cisco IOS", "Junos", "What the answer proves"]}
          rows={[
            ["Which VLAN is each access port in?", <Mono key="1">show vlan brief</Mono>, <Mono key="2">show vlans</Mono>, "The port, not the host, decides the VLAN"],
            ["What does the trunk carry?", <Mono key="3">show interfaces trunk</Mono>, <Mono key="4">show ethernet-switching interface</Mono>, "Both ends must allow every VLAN that must cross"],
            ["In which VLAN was a host learned?", <Mono key="5">show mac address-table</Mono>, <Mono key="6">show ethernet-switching table</Mono>, "Every entry is a (VLAN, MAC) pair"],
          ]}
        />
        <p>On a healthy SW1 the trunk allows VLANs 1, 10 and 20:</p>
        <CliPanel run={{ ...trunkOk, output: pickLines(trunkOk.output, allowedRows) }} caption="SW1 · Cisco IOS · healthy" />
        <p>And traffic confirms it: HOST-A → HOST-B answers with TTL 64, HOST-C → HOST-D too, and a capture on the trunk shows frames tagged VID 10 and VID 20.</p>
      </GuideSection>

      <GuideSection id="vl-incident" eyebrow="Incident" title="The incident: VLAN 10 stops crossing the trunk" tone="danger">
        <p>After a change on SW1, HOST-A can&apos;t reach HOST-B, while HOST-C and HOST-D keep talking across the same cable. The link is up, both switches are up, every host port is up.</p>
        <DiagramFrame caption="One VLAN fails while the other crosses the same, working cable.">
          <IncidentDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: ["SW1's trunk no longer allows VLAN 10", "VLAN 10 frames have no way across, so SW1 drops them", "VLAN 20 is still allowed, so it crosses as before"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["A cable fault: it would stop VLAN 20 too", "A wrong access VLAN: both host ports are still in VLAN 10", "An IP problem: HOST-A and HOST-B are in the same subnet, no router involved"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-investigate" eyebrow="Investigation" title="Follow VLAN 10, link by link" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Same VLAN, or between VLANs?", look: "HOST-A and HOST-B are both in VLAN 10: only the switches are involved." },
            { question: "Are both host ports still in VLAN 10?", look: "show vlan brief / show vlans on both switches: yes." },
            { question: "Does the trunk allow VLAN 10 at BOTH ends?", look: "show interfaces trunk on SW1: the allowed list no longer contains 10." },
          ]}
        />
        <CliPanel run={{ ...trunkBad, output: pickLines(trunkBad.output, allowedRows) }} caption="SW1 · Cisco IOS · during the incident" />
        <p className="text-sm text-pv-text-muted">A classic way to cause it: <Mono>switchport trunk allowed vlan 1,20</Mono> typed to &quot;add&quot; VLAN 20. Without the <Mono>add</Mono> keyword the command replaces the whole list, and VLAN 10 is gone.</p>
      </GuideSection>

      <GuideSection id="vl-repair" eyebrow="Repair" title="Repair, and prove it with fresh traffic" tone="success">
        <CompareCards
          items={[
            { title: "Cisco IOS · SW1", tone: "cyan", tag: "add, don't replace", points: ["interface Gi1/0/24", "switchport trunk allowed vlan add 10"] },
            { title: "Junos · SW1", tone: "violet", tag: "candidate → commit", points: ["set interfaces ge-0/0/24 unit 0 family ethernet-switching vlan members SALES", "commit"] },
          ]}
        />
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            "show interfaces trunk on SW1 lists VLAN 10 as allowed again",
            "A fresh HOST-A → HOST-B ping answers, with TTL 64",
            "A capture on the trunk shows frames tagged VID 10 again",
            "HOST-C → HOST-D was never interrupted",
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-other" eyebrow="Troubleshooting" title="Other ways VLANs break" tone="warning">
        <p>The missing allowed VLAN is one way to cut a VLAN. The lab&apos;s tickets add four more, each with its own evidence. The Deep Dive walks through all five with real Cisco and Junos output.</p>
        <CompareCards
          items={[
            { title: "A host port in the wrong VLAN", tone: "violet", tag: "one host isolated", points: ["The host reaches nobody, not even its gateway", "Its MAC is learned in the other VLAN"] },
            { title: "A native VLAN mismatch", tone: "danger", tag: "frames change VLAN", points: ["Nothing is down, nothing is dropped", "A host shows up in VLAN 1 on the far switch"] },
            { title: "A VLAN missing toward the router", tone: "warning", tag: "no gateway", points: ["Inside the VLAN fine, to the gateway fails", "No frames of that VID leave toward R1"] },
            { title: "The wrong VLAN ID on R1", tone: "ip", tag: "frames arrive, R1 drops them", points: ["Same symptom as the previous card", "R1's drop counter grows"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-model" eyebrow="Mental model" title="Colored lanes on one road" tone="cyan">
        <p>Each VLAN is a colored lane. Access ports are single-color on-ramps: the car gets its color when it enters, and the driver never knows. The trunk is a multi-lane road, and the tag is the paint on the car that says which lane it is in. The allowed list decides which lanes a trunk has: remove a lane at one end and those cars can&apos;t cross, while every other lane flows. To change lanes you have to leave the road at a router and come back on in another color.</p>
      </GuideSection>

      <GuideSection id="vl-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "VLAN", def: "Virtual LAN: one Layer-2 broadcast domain, created by the switches." },
            { term: "Access port", def: "Carries one VLAN, untagged, to an end host." },
            { term: "Trunk port", def: "Carries several VLANs, identified by 802.1Q tags." },
            { term: "VID", def: "12-bit VLAN ID in the tag. 1–4094 are usable." },
            { term: "Allowed VLAN list", def: "The VLANs a trunk will carry. Others are filtered." },
            { term: "Router on a stick", def: "One router port on a trunk, one subinterface (VID + gateway address) per VLAN." },
          ]}
        />
      </GuideSection>

      <GuideSection id="vl-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard tone="cyan" title="VLANs & Trunking in this lesson" mark="→" items={["Sales is VLAN 10 and Engineering VLAN 20, on the same two switches", "The access port decides a frame's VLAN; hosts never know their VLAN", `The trunk ${TRUNK_PORT} carries both VLANs, tagged; access links carry none`, "Broadcasts stay inside their VLAN; inside a VLAN the ping arrives with TTL 64", "Crossing VLANs needs a router: TTL 63", "One VLAN failing on a working cable is a VLAN setting: here, the trunk's allowed list"]} />
      </GuideSection>

      <GuideSection id="vl-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know what each port and each trunk should be doing, and how to prove it. The VLAN Lab gives you the same network with R1 attached, as Cisco IOS or Junos:</p>
        <FlowSteps
          steps={[
            { title: "Learn (6 levels)", body: "The same steps as this page, one decision at a time.", tone: "violet" },
            { title: "Challenges", body: "Prove a broadcast stays in its VLAN, catch a frame tagged and untagged, move HOST-D into Sales, prove the hairpin.", tone: "warning" },
            { title: "Troubleshoot (5 tickets)", body: "This lesson's incident and the four other faults above, reported as users report them.", tone: "danger" },
          ]}
        />
        <PresentationBridge>Watch the VLAN lanes, the tag being added and removed, a native-VLAN leak and the router hairpin animated in the VLAN presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (the tag bit by bit, native VLANs, real device output for every fault, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}
