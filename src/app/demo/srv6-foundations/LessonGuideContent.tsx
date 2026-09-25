import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import { DHeaderColumn, SRV6_HEX_POS, Srv6Topology, type Srv6Link } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const SRV6F_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lf-mission", label: "The mission" },
  { id: "lf-active", label: "Where the active segment lives" },
  { id: "lf-sid", label: "Anatomy of this lesson's SIDs" },
  { id: "lf-locator", label: "Locator route vs local SID" },
  { id: "lf-topology", label: "Topology and underlay" },
  { id: "lf-single", label: "One SID toward R6" },
  { id: "lf-srh", label: "Encoding ⟨R3, R6⟩" },
  { id: "lf-walk", label: "Walking ⟨R3, R6⟩" },
  { id: "lf-locexp", label: "The locator experiment" },
  { id: "lf-three", label: "Three segments" },
  { id: "lf-fault", label: "The broken program" },
  { id: "lf-mistakes", label: "Common mistakes" },
  { id: "lf-glossary", label: "Glossary" },
  { id: "lf-recap", label: "Mental model" },
];

const LINKS: Srv6Link[] = [
  { a: "R1", b: "R2", label: "10" },
  { a: "R2", b: "R3", label: "10" },
  { a: "R3", b: "R6", label: "10" },
  { a: "R1", b: "R4", label: "5" },
  { a: "R4", b: "R5", label: "5" },
  { a: "R5", b: "R6", label: "5" },
];

function ActiveSegmentDiagram() {
  return (
    <DiagramSvg h={200} label="SR-MPLS: the active segment is the top label 16003 of the stack. SRv6: the active segment is the IPv6 destination address, and the SRH carries the rest of the program">
      <text x={160} y={20} textAnchor="middle" fill={D.mpls} fontSize={12} fontWeight={700}>
        SR-MPLS
      </text>
      <DStack x={160} y={36} labels={[{ text: "16003", color: D.warning, tag: "ACTIVE" }, { text: "16006" }]} payload="IP" w={110} />
      <text x={480} y={20} textAnchor="middle" fill={D.ip} fontSize={12} fontWeight={700}>
        SRv6
      </text>
      <DHeaderColumn
        x={480}
        y={36}
        w={190}
        rows={[
          { text: "IPv6 DA = R3 End SID", color: D.warning, tag: "ACTIVE", strong: true },
          { text: "SRH: SL 1 · LE 1", color: D.violet, tag: "SRH" },
          { text: "[0] R6 · [1] R3", color: D.violet },
          { text: "payload", color: D.ip },
        ]}
      />
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={10}>
        SR-MPLS reads the top label; SRv6 reads the IPv6 Destination Address
      </text>
      <text x={320} y={186} textAnchor="middle" fill={D.muted} fontSize={10}>
        the SRH is only the rest of the program, when one is needed
      </text>
    </DiagramSvg>
  );
}

function SidAnatomyDiagram() {
  const cell = (x: number, w: number, label: string, value: string, color: string) => (
    <g>
      <rect x={x} y={40} width={w} height={40} rx={6} fill={color} fillOpacity={0.14} stroke={color} strokeOpacity={0.8} />
      <text x={x + w / 2} y={57} textAnchor="middle" fill={color} fontSize={10.5} fontWeight={700}>
        {label}
      </text>
      <text x={x + w / 2} y={72} textAnchor="middle" fill={D.text} fontSize={10.5} fontFamily="monospace">
        {value}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={150} label="R3's End SID: 64-bit locator 2001:db8:100:3, 16-bit function 0x1, no argument bits, remaining bits zero, giving 2001:db8:100:3:1::">
      <text x={320} y={24} textAnchor="middle" fill={D.muted} fontSize={10}>
        128-bit SID = LOC : FUNCT : ARG (this lesson uses no ARG bits)
      </text>
      {cell(40, 300, "LOCATOR /64", "2001:db8:100:3", D.cyan)}
      {cell(346, 110, "FUNCT 16 bits", "0x1 (End)", D.warning)}
      {cell(462, 138, "remaining bits", "0 (ARG = 0 bits)", D.faint)}
      <text x={320} y={112} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={700} fontFamily="monospace">
        = 2001:db8:100:3:1::
      </text>
      <text x={320} y={136} textAnchor="middle" fill={D.muted} fontSize={10}>
        R5 and R6 follow the same pattern: 2001:db8:100:5:1:: and 2001:db8:100:6:1::
      </text>
    </DiagramSvg>
  );
}

function TopologyDiagram() {
  return (
    <DiagramSvg h={240} label="Hexagon: top R1 R2 R3 R6 with metric 10 on each link, bottom R1 R4 R5 R6 with metric 5 on each link; R3, R5 and R6 own End SIDs">
      <Srv6Topology pos={SRV6_HEX_POS} links={LINKS} sub={{ R1: "headend", R3: "End :3:1::", R5: "End :5:1::", R6: "End :6:1::" }} accent={{ R1: D.ip, R3: D.warning, R5: D.warning, R6: D.warning }} boxW={84} />
      <text x={320} y={228} textAnchor="middle" fill={D.muted} fontSize={10}>
        numbers are IGP metrics · every node advertises its own locator 2001:db8:100:N::/64
      </text>
    </DiagramSvg>
  );
}

function SrhEncodingDiagram() {
  return (
    <DiagramSvg h={210} label="The program R3 then R6 is written left to right, but stored reversed: Segment List index 0 is R6, index 1 is R3; Last Entry 1, Segments Left 1, and the DA starts as R3's End SID">
      <text x={130} y={22} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        program (order of visit)
      </text>
      <text x={130} y={52} textAnchor="middle" fill={D.warning} fontSize={14} fontWeight={700} fontFamily="monospace">
        ⟨ R3 , R6 ⟩
      </text>
      <text x={130} y={74} textAnchor="middle" fill={D.muted} fontSize={10}>
        first → final
      </text>
      <DArrow x1={230} y1={50} x2={330} y2={50} color={D.faint} width={1.4} label="encode" />
      <DHeaderColumn
        x={470}
        y={22}
        w={210}
        rows={[
          { text: "DA = 2001:db8:100:3:1::", color: D.warning, tag: "IPv6 DA", strong: true },
          { text: "Segments Left = 1", color: D.violet, tag: "SL" },
          { text: "Last Entry = 1", color: D.violet, tag: "LE" },
          { text: "[0] 2001:db8:100:6:1:: (R6)", color: D.violet, tag: "final" },
          { text: "[1] 2001:db8:100:3:1:: (R3)", color: D.violet, tag: "first" },
          { text: "payload", color: D.ip },
        ]}
      />
      <text x={130} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        DA = Segment List[SL]
      </text>
      <text x={130} y={146} textAnchor="middle" fill={D.muted} fontSize={10}>
        LE = number of segments − 1
      </text>
    </DiagramSvg>
  );
}

function WalkDiagram() {
  const cols = [
    { x: 110, head: "R1 → R2", da: "DA R3 End", sl: "SL 1", note: "R1 FIB → R3's locator" },
    { x: 320, head: "R2 → R3", da: "DA R3 End", sl: "SL 1", note: "ordinary IPv6 transit" },
    { x: 530, head: "R3 → R6", da: "DA R6 End", sl: "SL 0", note: "after End at R3" },
  ];
  return (
    <DiagramSvg h={170} label="R1 to R2 and R2 to R3 carry DA R3 End with SL 1; R3 executes End, so R3 to R6 carries DA R6 End with SL 0; the Segment List never changes">
      {cols.map((c, i) => (
        <g key={c.head}>
          <text x={c.x} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
            {c.head}
          </text>
          <DHeaderColumn
            x={c.x}
            y={32}
            w={130}
            rows={[
              { text: c.da, color: D.warning, strong: true },
              { text: `${c.sl} · LE 1`, color: D.violet },
              { text: "[0] R6 · [1] R3", color: D.violet },
            ]}
            caption={c.note}
          />
          {i < cols.length - 1 && <DArrow x1={c.x + 72} y1={55} x2={c.x + 138} y2={55} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        storage order is never rewritten — only the DA and Segments Left change, and only at the SID&apos;s owner
      </text>
    </DiagramSvg>
  );
}

function FaultMethodDiagram() {
  const layers = ["interfaces / IGP", "locator route", "packet reaches owner", "local SID entry", "SRH / SL state"];
  return (
    <DiagramSvg h={120} label="Check layers bottom up: interfaces and IGP, the locator route, whether the packet reaches the owner, the owner's local SID entry, and the SRH state">
      {layers.map((l, i) => (
        <g key={l}>
          <rect x={20 + i * 124} y={34} width={112} height={40} rx={8} fill={D.box} stroke={D.cyan} strokeOpacity={0.6} />
          <text x={76 + i * 124} y={58} textAnchor="middle" fill={D.text} fontSize={10}>
            {l}
          </text>
          {i < layers.length - 1 && <DArrow x1={133 + i * 124} y1={54} x2={143 + i * 124} y2={54} color={D.faint} width={1.2} />}
        </g>
      ))}
      <text x={320} y={100} textAnchor="middle" fill={D.muted} fontSize={10}>
        check each layer with evidence before blaming the next one
      </text>
    </DiagramSvg>
  );
}

export function Srv6FoundationsLessonGuideContent() {
  return (
    <>
      <GuideSection id="lf-mission" eyebrow="Introduction" title="The mission: segment routing on the IPv6 data plane" tone="ip">
        <p>
          You already know SR-MPLS: an ordered list of segments carried as a label stack. This lesson builds the same idea on IPv6: a segment is a 128-bit IPv6 SID, the packet is forwarded by ordinary IPv6 routing, and the SID&apos;s owner runs a local behavior. Only the basic <Mono>End</Mono> behavior is used here.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          Six routers (R1 headend, R6 destination), /64 locators under <Mono>2001:db8:100::/48</Mono>, 16-bit functions, no argument bits, and a full SRH when more than one segment is needed. No headend encapsulation, service behaviors or compressed SIDs are modeled — those are later lessons.
        </Callout>
      </GuideSection>

      <GuideSection id="lf-active" eyebrow="Concepts" title="Where the active segment lives" tone="mpls">
        <DiagramFrame caption="Same idea — an ordered program — carried two different ways.">
          <ActiveSegmentDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lf-sid" eyebrow="SID anatomy" title="Anatomy of this lesson's SIDs" tone="violet">
        <DiagramFrame caption="A SID is derived from its owner's locator plus a function — not typed by hand.">
          <SidAnatomyDiagram />
        </DiagramFrame>
        <p>
          A SID only exists once its owner instantiates it in its Local SID Table and binds a behavior to it. In this lesson R3, R5 and R6 each instantiate one End SID with function <Mono>0x1</Mono>.
        </p>
      </GuideSection>

      <GuideSection id="lf-locator" eyebrow="Control plane" title="Locator route vs local SID" tone="ip">
        <CompareCards
          items={[
            { title: "Locator route", tone: "ospf", tag: "every router", points: ["2001:db8:100:N::/64 in the IGP", "Answers: how do I reach the owner?", "One aggregate FIB route per locator", "Used by transit routers"] },
            { title: "Local SID entry", tone: "violet", tag: "owner only", points: ["One exact 128-bit SID", "Answers: what does the owner do with it?", "Bound to a behavior (here End)", "Lives in the owner's Local SID Table"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="lf-topology" eyebrow="Setup" title="Topology and underlay" tone="ospf">
        <DiagramFrame caption="The lesson's hexagon. Every packet rides this IPv6 underlay.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>
          The underlay comes first: IGP adjacencies, locator reachability, and each router&apos;s IPv6 FIB. A router whose DA is not one of its own local SIDs forwards like any IPv6 router.
        </p>
      </GuideSection>

      <GuideSection id="lf-single" eyebrow="Data plane" title="One SID toward R6" tone="ip">
        <FlowSteps
          steps={[
            { title: "R1 classifies", body: <>DA = <Mono>2001:db8:100:6:1::</Mono> (R6 End SID).</>, tone: "ip" },
            { title: "R1, R4, R5", body: "No local SID match — ordinary IPv6 FIB forwarding toward R6's locator.", tone: "ospf" },
            { title: "R6", body: "Its Local SID Table matches the DA; End completes and the packet is delivered.", tone: "success" },
          ]}
        />
        <p>Watch the Packet Inspector here: it lists exactly the headers this packet carries, and nothing it does not.</p>
      </GuideSection>

      <GuideSection id="lf-srh" eyebrow="Data plane" title="Encoding ⟨R3, R6⟩" tone="warning">
        <DiagramFrame caption="Visit R3 first, then R6 — a program the DA alone cannot express.">
          <SrhEncodingDiagram />
        </DiagramFrame>
        <FieldTable
          title="SRH fields used in this lesson"
          accent="violet"
          columns={["Field", "Meaning here"]}
          rows={[
            ["Routing Type", <Mono key="rt">4 (SRH)</Mono>],
            ["Segments Left", "Index of the active segment in the Segment List"],
            ["Last Entry", "Index of the last element of the Segment List"],
            ["Segment List[i]", "SIDs stored in reverse order of visit"],
            ["Flags / Tag", <Mono key="f">0x00 / 0</Mono>],
            ["Hdr Ext Len", "2 per 128-bit SID (8-octet units, first 8 octets excluded)"],
          ]}
        />
      </GuideSection>

      <GuideSection id="lf-walk" eyebrow="Data plane" title="Walking ⟨R3, R6⟩" tone="ip">
        <DiagramFrame caption="Physical path R1 → R2 → R3 → R6 for two segments.">
          <WalkDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Local SID match", body: "R3's table matches the DA — that match, not arrival, triggers End.", tone: "violet" },
            { title: "Execute End", body: "SL 1 → 0, and Segment List[0] is copied into the DA.", tone: "warning" },
            { title: "FIB forward", body: "R3 looks up the new DA's locator: directly connected R6.", tone: "ospf" },
            { title: "Final End", body: "At R6 SL is already 0 — no further decrement; the packet is delivered.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="lf-locexp" eyebrow="Experiment" title="The locator experiment" tone="ospf">
        <p>
          The lesson raises the R4-R5 metric and resends the same single SID toward R6, then restores it. Compare the Local SID entry at R6, the DA in the packet, and the path R1&apos;s FIB picks before and after the change.
        </p>
      </GuideSection>

      <GuideSection id="lf-three" eyebrow="Data plane" title="Three segments: ⟨R3, R5, R6⟩" tone="warning">
        <FieldTable
          title="Stage by stage (Segment List stays [0] R6 · [1] R5 · [2] R3)"
          accent="warning"
          columns={["Stage", "DA", "SL / LE"]}
          rows={[
            ["R1 → R2 → R3", <Mono key="a">R3 End · 2001:db8:100:3:1::</Mono>, "2 / 2"],
            ["End at R3", <Mono key="b">R5 End · 2001:db8:100:5:1::</Mono>, "1 / 2"],
            ["R3 → R6 → R5 (R6 is transit)", <Mono key="c">R5 End</Mono>, "1 / 2"],
            ["End at R5", <Mono key="d">R6 End · 2001:db8:100:6:1::</Mono>, "0 / 2"],
            ["R5 → R6, final End", <Mono key="e">R6 End</Mono>, "0 / 2"],
          ]}
        />
      </GuideSection>

      <GuideSection id="lf-fault" eyebrow="Troubleshooting" title="The broken program" tone="danger">
        <DiagramFrame caption="A method, not an answer.">
          <FaultMethodDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="danger"
          title="How to reason about it (no spoilers)"
          mark="→"
          items={[
            "Confirm what still works: pings, the locator route, transit forwarding.",
            "Find the exact router where the program stops advancing.",
            "At that router, compare the packet's DA and SRH with every table the router uses.",
            "For each candidate cause, predict what the packet would do — and compare with what you observed.",
            "After any fix, resend the same program and follow it to R6 — a table change alone is not proof.",
          ]}
        />
      </GuideSection>

      <GuideSection id="lf-mistakes" eyebrow="Troubleshooting" title="Common mistakes" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Avoid these"
          mark="!"
          items={[
            "Reading the highlighted SRH row as the active segment instead of the DA.",
            "Reading Segment List[0] as the first segment to visit.",
            "Expecting every router on the path to change the SRH.",
            "Treating Segments Left as a hop counter.",
            "Assuming every SRv6 packet must carry an SRH.",
            "Treating a locator route as proof that a SID is instantiated.",
          ]}
        />
      </GuideSection>

      <GuideSection id="lf-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "SRv6 SID", def: "A 128-bit IPv6 address instantiated by a node and bound to a behavior." },
            { term: "Locator", def: "Routable prefix of a node's SIDs (here 2001:db8:100:N::/64)." },
            { term: "Function", def: "Bits after the locator identifying the local behavior (here 0x1 = End)." },
            { term: "Local SID Table", def: "A node's own instantiated SIDs and their behaviors." },
            { term: "SRH", def: "Segment Routing Header, an IPv6 Routing header of type 4 carrying the Segment List." },
            { term: "Segments Left (SL)", def: "Index of the active segment in the Segment List." },
            { term: "Last Entry (LE)", def: "Index of the last Segment List element." },
            { term: "End", def: "Basic endpoint: decrement SL, copy the next SID into the DA, forward by FIB." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lf-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          The locator gets the packet to the owner by plain IPv6 routing; the owner&apos;s Local SID Table decides what the SID means; and End advances the program by moving the next SID into the Destination Address.
        </Callout>
      </GuideSection>
    </>
  );
}
