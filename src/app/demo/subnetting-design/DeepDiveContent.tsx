import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { numToIp } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { CORRECT_PLAN, PARENT, alignedBlocks, freeRanges, maskOf } from "@/lib/sim-engine/scenarios/subnettingDesign";

export const SD_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "sdd-binary", label: "Masks in binary" },
  { id: "sdd-order", label: "Why largest first" },
  { id: "sdd-free", label: "Describing free space" },
  { id: "sdd-31", label: "/31 point-to-point" },
  { id: "sdd-32", label: "/32 host routes" },
  { id: "sdd-aggregate", label: "Aggregation" },
  { id: "sdd-workflow", label: "Design workflow" },
  { id: "sdd-glossary", label: "Glossary" },
];

function BinaryMasksDiagram() {
  const rows = [25, 26, 27, 30];
  return (
    <DiagramSvg h={190} label={`Last octet of each mask in binary: ${rows.map((p) => `/${p} ${maskOf(p).split(".")[3]}`).join(", ")}`}>
      {rows.map((p, i) => {
        const bits = (Number(maskOf(p).split(".")[3]) >>> 0).toString(2).padStart(8, "0").split("");
        const y = 22 + i * 40;
        return (
          <g key={p}>
            <text x={20} y={y + 20} fill={D.text} fontSize={11} fontWeight={700} fontFamily="monospace">
              /{p}
            </text>
            <text x={70} y={y + 20} fill={D.muted} fontSize={10} fontFamily="monospace">
              {maskOf(p)}
            </text>
            <DFieldRow x={230} y={y} h={30} fields={bits.map((b, j) => ({ label: b, w: 36, color: b === "1" ? D.violet : D.success, strong: b === "1" && j === 7 - (32 - p - 1) }))} />
            <text x={530} y={y + 20} fill={D.muted} fontSize={10}>
              block {2 ** (32 - p)}
            </text>
          </g>
        );
      })}
    </DiagramSvg>
  );
}

function OrderDiagram() {
  const px = (o: number) => 150 + (o / 256) * 460;
  const smallFirst = [
    { o: 0, s: 4, c: D.warning },
    { o: 32, s: 32, c: D.success },
    { o: 64, s: 64, c: D.violet },
    { o: 128, s: 128, c: D.cyan },
  ];
  const largeFirst = [
    { o: 0, s: 128, c: D.cyan },
    { o: 128, s: 64, c: D.violet },
    { o: 192, s: 32, c: D.success },
    { o: 224, s: 4, c: D.warning },
  ];
  const bar = (y: number, blocks: { o: number; s: number; c: string }[]) => blocks.map((b) => <rect key={`${y}-${b.o}`} x={px(b.o)} y={y} width={px(b.o + b.s) - px(b.o) - 1} height={26} rx={3} fill={b.c} fillOpacity={0.25} stroke={b.c} />);
  return (
    <DiagramSvg h={160} label="Smallest-first placing the /30 at .0 forces the /27 to .32 and the /26 to .64, leaving gaps; largest-first packs /25, /26, /27 and /30 with one contiguous free range at the end">
      <text x={20} y={46} fill={D.danger} fontSize={11} fontWeight={700}>
        smallest first
      </text>
      {bar(28, smallFirst)}
      <text x={20} y={106} fill={D.success} fontSize={11} fontWeight={700}>
        largest first
      </text>
      {bar(88, largeFirst)}
      <text x={20} y={138} fill={D.muted} fontSize={10}>
        Small-first leaves gaps (.4–.31) that no large block can use.
      </text>
      <text x={20} y={154} fill={D.muted} fontSize={10}>
        Largest-first leaves one contiguous free range at the end.
      </text>
    </DiagramSvg>
  );
}

function FreeSpaceDiagram() {
  const free = freeRanges(CORRECT_PLAN)[0];
  const blocks = alignedBlocks(free);
  const px = (o: number) => 60 + ((o - 224) / 32) * 520;
  const lo = (ip: string) => Number(ip.split(".")[3]);
  return (
    <DiagramSvg h={170} label={`Free range ${numToIp(free.first)} to ${numToIp(free.last)} decomposes into the aligned blocks ${blocks.map((b) => `${b.network}/${b.prefix}`).join(", ")}`}>
      <rect x={px(224)} y={30} width={px(228) - px(224) - 1} height={30} rx={3} fill={D.warning} fillOpacity={0.2} stroke={D.warning} />
      <text x={(px(224) + px(228)) / 2} y={50} textAnchor="middle" fill={D.warning} fontSize={9}>
        transit
      </text>
      {blocks.map((b) => {
        const s = lo(b.network);
        const e = s + 2 ** (32 - b.prefix);
        return (
          <g key={b.network}>
            <rect x={px(s)} y={30} width={px(e) - px(s) - 1} height={30} rx={3} fill={D.box} stroke={D.faint} strokeDasharray="4 3" />
            <text x={(px(s) + px(e)) / 2} y={50} textAnchor="middle" fill={D.text} fontSize={10} fontFamily="monospace">
              .{s}/{b.prefix}
            </text>
          </g>
        );
      })}
      {[224, 228, 232, 240, 256].map((o) => (
        <text key={o} x={px(o)} y={78} textAnchor="middle" fill={D.faint} fontSize={9} fontFamily="monospace">
          {o === 256 ? "256" : `.${o}`}
        </text>
      ))}
      <text x={60} y={110} fill={D.text} fontSize={10.5}>
        {numToIp(free.first)} – {numToIp(free.last)} is {free.last - free.first + 1} addresses: not a power of two, so it is not one prefix.
      </text>
      <text x={60} y={130} fill={D.muted} fontSize={10}>
        It can still hold aligned blocks: {blocks.map((b) => `${b.network}/${b.prefix}`).join(" + ")}.
      </text>
    </DiagramSvg>
  );
}

function Slash31Diagram() {
  return (
    <DiagramSvg h={170} label="A /30 transit link uses 4 addresses, network and broadcast reserved, two usable; a /31 point-to-point link per RFC 3021 uses 2 addresses, both usable, with no network or broadcast address">
      <text x={20} y={24} fill={D.warning} fontSize={11} fontWeight={700}>
        /30 (conventional)
      </text>
      <DFieldRow x={20} y={32} h={30} fields={[{ label: ".224 net", w: 80, color: D.faint }, { label: ".225 R1", w: 80, color: D.warning, strong: true }, { label: ".226 R2", w: 80, color: D.warning, strong: true }, { label: ".227 bc", w: 80, color: D.faint }]} />
      <text x={20} y={96} fill={D.violet} fontSize={11} fontWeight={700}>
        /31 (RFC 3021, point-to-point only)
      </text>
      <DFieldRow x={20} y={104} h={30} fields={[{ label: ".224 R1", w: 80, color: D.violet, strong: true }, { label: ".225 R2", w: 80, color: D.violet, strong: true }]} />
      <text x={370} y={52} fill={D.muted} fontSize={10}>
        2 of 4 usable
      </text>
      <text x={200} y={124} fill={D.muted} fontSize={10}>
        2 of 2 usable — the minus-2 rule doesn&apos;t apply
      </text>
    </DiagramSvg>
  );
}

function Slash32Diagram() {
  return (
    <DiagramSvg h={150} label="A /32 identifies exactly one address, used for loopbacks and host routes; it is a route to one host, not a subnet of hosts">
      <DNode x={120} y={70} label="R1 loopback" sub="10.44.1.1/32" accent={D.cyan} w={140} />
      <DNode x={460} y={70} label="R2" sub="route 10.44.1.1/32 → R1" accent={D.ip} w={170} />
      <DArrow x1={375} y1={70} x2={192} y2={70} color={D.cyan} label="exactly one address" />
      <text x={20} y={130} fill={D.muted} fontSize={10}>
        Block size 1: no host range, network or broadcast. Loopbacks are typically numbered from a separate block.
      </text>
    </DiagramSvg>
  );
}

function AggregationDiagram() {
  return (
    <DiagramSvg h={190} label={`R1 owns ${CORRECT_PLAN.filter((a) => a.id !== "TRANSIT").map((a) => `${a.network}/${a.prefix}`).join(", ")}; because the plan was carved from one parent, another router can reach them all with the single summary ${PARENT.network}/${PARENT.prefix}`}>
      {CORRECT_PLAN.filter((a) => a.id !== "TRANSIT").map((a, i) => (
        <g key={a.id}>
          <DNode x={100 + i * 150} y={40} label={`${a.network}/${a.prefix}`} w={140} accent={D.violet} />
          <DArrow x1={100 + i * 150} y1={62} x2={300} y2={112} color={D.muted} width={1.4} />
        </g>
      ))}
      <DNode x={300} y={134} label={`${PARENT.network}/${PARENT.prefix}`} sub="one summary toward R2" w={200} accent={D.success} />
      <DLink x1={400} y1={134} x2={520} y2={134} color={D.success} />
      <DPill x={570} y={134} text="R2" color={D.ip} w={60} />
    </DiagramSvg>
  );
}

export function SubnettingDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="sdd-binary" eyebrow="CIDR" title="Masks in binary" tone="violet">
        <DiagramFrame caption="Each extra network bit halves the block. The lowest 1 in the mask gives the block size.">
          <BinaryMasksDiagram />
        </DiagramFrame>
        <p>CIDR (RFC 4632) reads the network boundary only from the prefix length. The first octet never implies a size; classful A/B/C rules play no part in modern addressing.</p>
      </GuideSection>

      <GuideSection id="sdd-order" eyebrow="Strategy" title="Why largest-first" tone="success">
        <DiagramFrame caption="Same four blocks, two orders.">
          <OrderDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-free" eyebrow="Space" title="Describing free space honestly" tone="warning">
        <DiagramFrame caption="Free space is a range. Break it into aligned blocks only when you need to allocate from it.">
          <FreeSpaceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-31" eyebrow="Advanced context" title="/31 on point-to-point links" tone="violet">
        <DiagramFrame caption="RFC 3021 allows /31 where a link has exactly two ends.">
          <Slash31Diagram />
        </DiagramFrame>
        <Callout tone="warning" title="Scope">
          The lesson uses the conventional /30. A /31 saves two addresses per link where both routers support it. It has no network or broadcast address, so the ordinary 2^h − 2 arithmetic doesn&apos;t apply to it.
        </Callout>
      </GuideSection>

      <GuideSection id="sdd-32" eyebrow="Advanced context" title="/32: one address" tone="cyan">
        <DiagramFrame caption="Host routes and loopbacks.">
          <Slash32Diagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-aggregate" eyebrow="Routing relationship" title="Good plans summarise" tone="success">
        <DiagramFrame caption="Carving from one parent keeps the plan summarisable.">
          <AggregationDiagram />
        </DiagramFrame>
        <p>
          Because every block came from <Mono>{PARENT.network}/{PARENT.prefix}</Mono>, a distant router needs one route instead of four. How that summary gets advertised is a routing topic, outside this lab.
        </p>
      </GuideSection>

      <GuideSection id="sdd-workflow" eyebrow="Workflow" title="A repeatable design workflow" tone="danger">
        <FlowSteps
          steps={[
            { title: "List requirements", body: "Hosts per network, plus growth headroom if the design calls for it.", tone: "cyan" },
            { title: "Size", body: "Smallest h with 2^h − 2 ≥ hosts. Prefix = 32 − h.", tone: "violet" },
            { title: "Sort and place", body: "Largest first, each at the next free multiple of its block size.", tone: "success" },
            { title: "Validate", body: "Aligned, big enough, inside the parent, no overlaps.", tone: "warning" },
            { title: "Document and verify", body: "Record network, range and broadcast; deploy; test with traffic.", tone: "ip" },
          ]}
        />
        <FieldTable
          title="Quick reference"
          columns={["Prefix", "Mask", "Block", "Usable"]}
          rows={[25, 26, 27, 28, 29, 30].map((p) => [`/${p}`, maskOf(p), `${2 ** (32 - p)}`, `${2 ** (32 - p) - 2}`])}
        />
      </GuideSection>

      <GuideSection id="sdd-glossary" eyebrow="Glossary" title="Deep-dive terms" tone="violet">
        <Glossary
          items={[
            { term: "CIDR", def: "Classless Inter-Domain Routing (RFC 4632)." },
            { term: "RFC 3021", def: "Allows 31-bit prefixes on point-to-point links." },
            { term: "Host route", def: "A /32 route to a single address." },
            { term: "Summary route", def: "One shorter prefix covering several aligned blocks." },
            { term: "Fragmentation (of space)", def: "Free space scattered into gaps too small for large blocks." },
          ]}
        />
        <ChecklistCard tone="warning" title="Never" mark="✕" items={["Use classful A/B/C rules to size networks", "Call a misaligned range a subnet", "Deploy overlapping prefixes"]} />
      </GuideSection>
    </div>
  );
}
