import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import { SrTopology, type SrLink } from "@/components/lesson/SrGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const SRF_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "sf-mission", label: "The mission" },
  { id: "sf-topology", label: "Topology and IGP" },
  { id: "sf-srgb", label: "SRGB: index → label" },
  { id: "sf-control", label: "How SIDs are learned" },
  { id: "sf-node", label: "Node-SID forwarding" },
  { id: "sf-metric", label: "When the IGP changes" },
  { id: "sf-adj", label: "The local Adj-SID" },
  { id: "sf-list", label: "Logical list vs wire stack" },
  { id: "sf-php", label: "PHP in this lesson" },
  { id: "sf-planes", label: "Control vs data plane" },
  { id: "sf-fault", label: "The failing segment list" },
  { id: "sf-mistakes", label: "Common mistakes" },
  { id: "sf-challenge", label: "The engineer challenge" },
  { id: "sf-glossary", label: "Glossary" },
  { id: "sf-recap", label: "Mental model" },
];

const LINKS: SrLink[] = [
  { a: "R1", b: "R2", label: "10" },
  { a: "R2", b: "R4", label: "10" },
  { a: "R4", b: "R6", label: "10" },
  { a: "R1", b: "R3", label: "15" },
  { a: "R3", b: "R5", label: "15" },
  { a: "R5", b: "R6", label: "15" },
];

function TopologyDiagram() {
  return (
    <DiagramSvg h={220} label="R1 to R6 over a top path R2, R4 with metric 10 per link and a bottom path R3, R5 with metric 15 per link">
      <SrTopology links={LINKS.map((l) => (l.a === "R1" && l.b === "R2") || l.b === "R4" || (l.a === "R4" && l.b === "R6") ? { ...l, color: D.success, bold: true } : l)} sub={{ R1: "headend", R3: "owns 24035", R6: "destination" }} accent={{ R1: D.mpls, R6: D.mpls }} />
      <text x={320} y={214} textAnchor="middle" fill={D.muted} fontSize={10}>
        top path cost 30 (IGP shortest) · bottom path cost 45
      </text>
    </DiagramSvg>
  );
}

function SrgbDiagram() {
  const rows = [1, 2, 3, 4, 5, 6];
  return (
    <DiagramSvg h={150} label="Each router's Prefix-SID index plus the SRGB start 16000 gives its Node SID label: R1 16001 through R6 16006">
      <text x={320} y={18} textAnchor="middle" fill={D.violet} fontSize={11} fontWeight={700}>
        SRGB 16000–23999 · label = 16000 + index
      </text>
      {rows.map((i) => {
        const x = 60 + (i - 1) * 104;
        return (
          <g key={i}>
            <rect x={x - 42} y={36} width={84} height={30} rx={8} fill={D.box} stroke={D.cyan} strokeOpacity={0.7} />
            <text x={x} y={55} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
              R{i} · idx {i}
            </text>
            <DArrow x1={x} y1={70} x2={x} y2={92} color={D.faint} width={1.4} />
            <rect x={x - 42} y={96} width={84} height={26} rx={6} fill={D.mpls} fillOpacity={0.14} stroke={D.mpls} strokeOpacity={0.8} />
            <text x={x} y={113} textAnchor="middle" fill={D.mpls} fontSize={11} fontWeight={700} fontFamily="monospace">
              {16000 + i}
            </text>
          </g>
        );
      })}
      <text x={320} y={142} textAnchor="middle" fill={D.muted} fontSize={10}>
        the index is what the IGP advertises; the label is what the data plane carries
      </text>
    </DiagramSvg>
  );
}

/** Hop strip: routers in a row, the packet as it leaves each hop drawn under the link it crosses. */
function HopStrip({ hops, stacks, caption, label, h = 170 }: { hops: string[]; stacks: { labels: { text: string; color?: string; tag?: string }[]; payload?: string }[]; caption: string; label: string; h?: number }) {
  const step = 540 / (hops.length - 1);
  const xs = hops.map((_, i) => 50 + i * step);
  return (
    <DiagramSvg h={h} label={label}>
      {hops.map((r, i) => (
        <g key={r}>
          <DNode x={xs[i]} y={32} label={r} w={64} h={32} accent={i === 0 || i === hops.length - 1 ? D.mpls : D.cyan} />
          {i < hops.length - 1 && <DArrow x1={xs[i] + 36} y1={32} x2={xs[i + 1] - 36} y2={32} color={D.mpls} width={1.8} />}
        </g>
      ))}
      {stacks.map((s, i) => (
        <DStack key={i} x={(xs[i] + xs[i + 1]) / 2} y={62} labels={s.labels} payload={s.payload ?? "IP"} w={96} />
      ))}
      <text x={320} y={h - 8} textAnchor="middle" fill={D.muted} fontSize={10}>
        {caption}
      </text>
    </DiagramSvg>
  );
}

function NodeSidDiagram() {
  return (
    <HopStrip
      hops={["R1", "R2", "R4", "R6"]}
      stacks={[{ labels: [{ text: "16006 S1" }] }, { labels: [{ text: "16006 S1" }] }, { labels: [], payload: "IP (after PHP)" }]}
      caption="R2 forwards 16006 unchanged; R4 is penultimate for R6 and pops it"
      label="R1 pushes 16006 toward R2, R2 forwards 16006 to R4, R4 pops it and R6 receives plain IP"
      h={150}
    />
  );
}

function WireStackDiagram() {
  const cols = [
    { x: 130, head: "R1 → R3", labels: [{ text: "24035 S0", color: D.warning, tag: "TOP" }, { text: "16006 S1", tag: "BOTTOM" }], payload: "IP" },
    { x: 330, head: "R3 → R5", labels: [{ text: "16006 S1", tag: "TOP" }], payload: "IP" },
    { x: 530, head: "R5 → R6", labels: [], payload: "IP only" },
  ];
  return (
    <DiagramSvg h={170} label="Wire stacks: R1 to R3 carries 24035 over 16006, R3 to R5 carries 16006, R5 to R6 carries plain IP">
      {cols.map((c) => (
        <g key={c.head}>
          <text x={c.x} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
            {c.head}
          </text>
          <DStack x={c.x} y={32} labels={c.labels} payload={c.payload} w={96} />
        </g>
      ))}
      <text x={130} y={124} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        16003 done by PHP at R1
      </text>
      <text x={330} y={124} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        R3 executed its own 24035
      </text>
      <text x={530} y={124} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        16006 done by PHP at R5
      </text>
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        the logical list never changes; the wire stack only carries what the next router must read
      </text>
    </DiagramSvg>
  );
}

function FaultDiagram() {
  return (
    <DiagramSvg h={240} label="An incorrect list starting with R3's local Adj-SID is rejected at R1 because R1 does not own 24035">
      <SrTopology links={LINKS} sub={{ R1: "active: 24035", R3: "owns 24035" }} accent={{ R1: D.danger, R3: D.warning }} />
      <DPill x={320} y={222} text="R1 cannot execute a SID that only R3 owns → dropped at R1" color={D.danger} w={380} />
    </DiagramSvg>
  );
}

export function SrFoundationsLessonGuideContent() {
  return (
    <>
      <GuideSection id="sf-mission" eyebrow="Introduction" title="The mission: steer with instructions, not signaling" tone="mpls">
        <p>
          LDP follows the IGP shortest path; RSVP-TE signals an engineered LSP hop by hop. This lesson asks whether MPLS traffic can be steered by a short, ordered list of instructions imposed once at the headend (R1) — with no per-LSP signaling.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          Six routers, one SRGB shared by all of them, one local Adj-SID (R3→R5). The IGP is kept protocol-neutral: SR extensions carry SIDs the same way under OSPF or IS-IS. This lesson models penultimate-hop popping (implicit-null) for every Node SID.
        </Callout>
      </GuideSection>

      <GuideSection id="sf-topology" eyebrow="Setup" title="Topology and IGP" tone="ospf">
        <DiagramFrame caption="Numbers are IGP metrics. The green top path is the IGP shortest path.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>
          Loopbacks are <Mono>10.0.0.1/32</Mono> … <Mono>10.0.0.6/32</Mono>. Plain IP from <Mono>192.168.1.10</Mono> to <Mono>192.168.6.20</Mono> follows R1 → R2 → R4 → R6, cost 30. SR never replaces this IGP; it rides on top of it.
        </p>
      </GuideSection>

      <GuideSection id="sf-srgb" eyebrow="Control plane" title="SRGB: index → label" tone="violet">
        <DiagramFrame caption="The SID index is advertised; the label is derived locally from the SRGB.">
          <SrgbDiagram />
        </DiagramFrame>
        <p>
          A Node SID is simply the Prefix-SID of a router&apos;s own loopback. R6&apos;s index is <Mono>6</Mono>, so its label in this SRGB is <Mono>16006</Mono>. This lesson uses one SRGB everywhere for clarity; real networks are not required to.
        </p>
      </GuideSection>

      <GuideSection id="sf-control" eyebrow="Control plane" title="How SIDs are learned" tone="violet">
        <FlowSteps
          steps={[
            { title: "IGP adjacency", body: "Routers exchange link state as usual.", tone: "ospf" },
            { title: "SR extensions", body: "The IGP also carries SR capability, the SRGB, Prefix-SID indexes and Adj-SIDs.", tone: "violet" },
            { title: "SID database", body: "Each router records every SID: Node SIDs global, ordinary Adj-SIDs local to their owner.", tone: "cyan" },
            { title: "MPLS forwarding", body: "Each router programs its own LFIB from its own shortest paths.", tone: "mpls" },
          ]}
        />
      </GuideSection>

      <GuideSection id="sf-node" eyebrow="Data plane" title="Node-SID forwarding" tone="mpls">
        <DiagramFrame caption="The packet as it leaves each router. 16006 is a single label, so it is also the bottom (S=1).">
          <NodeSidDiagram />
        </DiagramFrame>
        <p>
          R1 imposes one segment, <Mono>16006</Mono>: &quot;reach R6 by the current shortest path.&quot; Every transit router forwards toward R6 using its <b className="text-pv-text">own</b> shortest path; the label stays the same because every router agrees what 16006 means. R4, the penultimate hop, pops it because R6 advertised implicit-null.
        </p>
      </GuideSection>

      <GuideSection id="sf-metric" eyebrow="Data plane" title="When the IGP changes" tone="warning">
        <p>
          The lesson raises R2-R4 from 10 to 50. The top path now costs 70, the bottom path 45. You then send the same single segment again and watch which routers carry it and which router becomes the penultimate hop. Use this to decide what a Node SID really promises before the lesson asks you.
        </p>
      </GuideSection>

      <GuideSection id="sf-adj" eyebrow="Control plane" title="The local Adj-SID" tone="violet">
        <FieldTable
          title="SIDs used in this lesson"
          accent="violet"
          columns={["SID", "Type", "Owner / scope", "Meaning"]}
          rows={[
            [<Mono key="a">16003</Mono>, "Node (Prefix-SID)", "R3 · global", "Reach R3 by the shortest path"],
            [<Mono key="b">16006</Mono>, "Node (Prefix-SID)", "R6 · global", "Reach R6 by the shortest path"],
            [<Mono key="c">24035</Mono>, "Adjacency SID", "R3 · local", "At R3, send over the R3→R5 link"],
          ]}
        />
        <Callout tone="warning" title="Local means local" icon="!">
          24035 is known in the SR domain, but only R3 can execute it. At any other router it is not an instruction to &quot;go to R3 and then use R3→R5&quot;.
        </Callout>
      </GuideSection>

      <GuideSection id="sf-list" eyebrow="Data plane" title="Logical list vs wire stack" tone="mpls">
        <FieldTable
          title="Logical segment list at R1 (top first)"
          accent="mpls"
          columns={["#", "SID", "Instruction", "Completes"]}
          rows={[
            ["1 · TOP / ACTIVE", <Mono key="a">16003</Mono>, "Reach R3", "By PHP at R1 (R1 is R3's penultimate hop)"],
            ["2", <Mono key="b">24035</Mono>, "At R3, use R3→R5", "At R3, its owner"],
            ["3 · BOTTOM / LAST", <Mono key="c">16006</Mono>, "Reach R6", "By PHP at R5 (R5 is R6's penultimate hop)"],
          ]}
        />
        <DiagramFrame caption="What each wire actually carries. 16003 never crosses R1 → R3; 16006 never reaches R6.">
          <WireStackDiagram />
        </DiagramFrame>
        <p>
          The logical list is R1&apos;s instruction list and does not change. The wire stack is only what the next router must read: R3 receives <Mono>24035 S0 / 16006 S1</Mono>, executes its own Adj-SID, and sends <Mono>16006 S1</Mono> over R3→R5. R5 pops 16006 and R6 receives plain IP.
        </p>
      </GuideSection>

      <GuideSection id="sf-php" eyebrow="Data plane" title="PHP in this lesson" tone="mpls">
        <FieldTable
          title="Where each Node SID leaves the packet"
          accent="mpls"
          columns={["Flow", "Node SID", "Popped by (penultimate hop)", "Target receives"]}
          rows={[
            ["Top path", <Mono key="a">16006</Mono>, "R4", "R6: plain IP"],
            ["After R2-R4 = 50", <Mono key="b">16006</Mono>, "R5", "R6: plain IP"],
            ["Steered list", <Mono key="c">16003</Mono>, "R1 (never imposed)", "R3: 24035 on top"],
            ["Steered list", <Mono key="d">16006</Mono>, "R5", "R6: plain IP"],
          ]}
        />
        <p>PHP is a property of the SID a router advertises and of each LFIB entry — not of a headend&apos;s segment list. The same label always gets the same treatment at the same router.</p>
      </GuideSection>

      <GuideSection id="sf-planes" eyebrow="Model" title="Control plane vs data plane" tone="cyan">
        <CompareCards
          items={[
            { title: "Control plane", tone: "violet", tag: "learned in advance", points: ["IGP topology and metrics", "SR capability and SRGB", "Prefix-SID indexes and Adj-SIDs", "Each router's LFIB"] },
            { title: "Data plane", tone: "mpls", tag: "per packet", points: ["R1 imposes the stack once", "Transit routers act on the top label only", "Node SID: forward on own shortest path", "Adj-SID: owner pops it and uses that link"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="sf-fault" eyebrow="Troubleshooting" title="The failing segment list" tone="danger">
        <DiagramFrame caption="Everything is healthy except that the first active SID cannot be executed where it becomes active.">
          <FaultDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="danger"
          title="How to reason about it (no spoilers)"
          mark="→"
          items={["Confirm the IGP, SR capability and Node-SID forwarding are healthy first.", "Write down which SID is on top at the router that must act on it.", "For that SID, ask: who owns it, and is it global or local?", "A fix must make every SID executable at the router where it becomes active.", "Verify with a real packet after any change."]}
        />
      </GuideSection>

      <GuideSection id="sf-mistakes" eyebrow="Troubleshooting" title="Common mistakes" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Avoid these"
          mark="!"
          items={["Treating a Node SID as a fixed path — it follows the current shortest path.", "Treating a local Adj-SID as globally executable.", "Confusing a SID index with the MPLS label.", "Reading the logical segment list as the wire stack when PHP applies.", "Expecting the destination to pop its own Node SID when it advertised implicit-null."]}
        />
      </GuideSection>

      <GuideSection id="sf-challenge" eyebrow="Challenge" title="The engineer challenge" tone="violet">
        <p>Deliver R1 → R6 through R3, specifically over R3→R5. Build it from what you proved: which instruction reaches a router, which instruction pins a link, and at which router each one becomes active.</p>
      </GuideSection>

      <GuideSection id="sf-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Segment", def: "One instruction, e.g. \"reach R6\" or \"at R3, use R3→R5\"." },
            { term: "SID", def: "Segment identifier; in SR-MPLS it is encoded as an MPLS label." },
            { term: "Prefix-SID / Node SID", def: "Global SID for a prefix; a Node SID is the Prefix-SID of a router's loopback." },
            { term: "Adj-SID", def: "SID for one adjacency; ordinary Adj-SIDs are local to their owner." },
            { term: "SRGB", def: "Label block a router derives Prefix-SID labels from (here 16000–23999)." },
            { term: "Active SID", def: "The label on top of the stack — the instruction being executed now." },
            { term: "PHP / implicit-null", def: "The penultimate hop pops the target's SID so the target receives the payload." },
            { term: "Headend", def: "The router that imposes the segment list (R1)." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sf-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          The IGP learns the SIDs; the headend writes an ordered list; each router only ever executes the SID on top — a Node SID by its own shortest path, a local Adj-SID only at its owner — and PHP removes a Node SID one hop early.
        </Callout>
      </GuideSection>
    </>
  );
}
