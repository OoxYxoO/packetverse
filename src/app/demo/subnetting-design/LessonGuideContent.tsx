import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ipToNum, numToIp } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { CORRECT_PLAN, PARENT, SD_ADDR, SEGMENTS, blockSize, dA, dB, dC, dT, describe, freeRanges, maskOf, prefixFor } from "@/lib/sim-engine/scenarios/subnettingDesign";

export const SD_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "sd-mission", label: "The mission" },
  { id: "sd-requirements", label: "Requirements" },
  { id: "sd-powers", label: "Powers of two" },
  { id: "sd-map", label: "The address map" },
  { id: "sd-boundaries", label: "Block boundaries" },
  { id: "sd-overlap", label: "Overlap incident" },
  { id: "sd-verify", label: "Verification" },
  { id: "sd-model", label: "Mental model" },
  { id: "sd-glossary", label: "Glossary" },
  { id: "sd-recap", label: "Recap" },
];

const oct = (ip: string) => ipToNum(ip) % 256;
const SEG_COLOR: Record<string, string> = { "LAN-A": D.cyan, "LAN-B": D.violet, "LAN-C": D.success, TRANSIT: D.warning };

function RequirementsDiagram() {
  const maxW = 300;
  return (
    <DiagramSvg h={200} label={`Requirements vs chosen block sizes: ${SEGMENTS.map((s) => `${s.id} ${s.hosts} hosts gets /${prefixFor(s.hosts).prefix} with ${2 ** (32 - prefixFor(s.hosts).prefix) - 2} usable`).join(", ")}`}>
      {SEGMENTS.map((s, i) => {
        const { prefix } = prefixFor(s.hosts);
        const y = 24 + i * 42;
        const cap = blockSize(prefix);
        return (
          <g key={s.id}>
            <text x={20} y={y + 13} fill={D.text} fontSize={11} fontWeight={700}>
              {s.id}
            </text>
            <rect x={110} y={y} width={(cap / 128) * maxW} height={18} rx={4} fill={SEG_COLOR[s.id]} fillOpacity={0.15} stroke={SEG_COLOR[s.id]} strokeOpacity={0.7} />
            <rect x={110} y={y} width={Math.max(3, (s.hosts / 128) * maxW)} height={18} rx={4} fill={SEG_COLOR[s.id]} fillOpacity={0.55} />
            <text x={110 + (cap / 128) * maxW + 8} y={y + 13} fill={D.muted} fontSize={10} fontFamily="monospace">
              {s.hosts} needed · /{prefix} = {cap} ({cap - 2} usable)
            </text>
          </g>
        );
      })}
      <text x={110} y={194} fill={D.faint} fontSize={9.5}>
        solid = hosts needed · outline = block size of the chosen prefix
      </text>
    </DiagramSvg>
  );
}

function PowersDiagram() {
  const rows = [2, 3, 4, 5, 6, 7, 8].map((h) => [`${h}`, `/${32 - h}`, `${2 ** h}`, `${2 ** h - 2}`]);
  const chosen = SEGMENTS.map((s) => prefixFor(s.hosts).hostBits);
  return (
    <DiagramSvg h={230} label="Host bits h, prefix 32 minus h, block size 2 to the h, ordinary usable hosts 2 to the h minus 2; chosen rows for the transit link, LAN-C, LAN-B and LAN-A are highlighted">
      <DTable
        x={20}
        y={10}
        title="2^h − 2 ordinary hosts"
        cols={[
          { label: "HOST BITS", w: 90 },
          { label: "PREFIX", w: 70 },
          { label: "BLOCK", w: 70 },
          { label: "USABLE", w: 70 },
        ]}
        rows={rows}
        highlight={{ row: rows.findIndex((r) => r[0] === "5"), color: D.success }}
      />
      {chosen.map((h, i) => (
        <text key={SEGMENTS[i].id} x={360} y={60 + i * 26} fill={SEG_COLOR[SEGMENTS[i].id]} fontSize={10.5} fontWeight={700}>
          {SEGMENTS[i].id}: {SEGMENTS[i].hosts} → h = {h} → /{32 - h}
        </text>
      ))}
      <text x={360} y={180} fill={D.muted} fontSize={10}>
        Pick the smallest h with 2^h − 2 ≥ hosts.
      </text>
    </DiagramSvg>
  );
}

function AddressMapDiagram() {
  const x0 = 20;
  const w = 600;
  const px = (o: number) => x0 + (o / 256) * w;
  const free = freeRanges(CORRECT_PLAN);
  return (
    <DiagramSvg h={190} label={`${PARENT.network}/${PARENT.prefix} laid out: ${CORRECT_PLAN.map((a) => `${a.id} ${a.network}/${a.prefix}`).join(", ")}, then free space ${free.map((f) => `${numToIp(f.first)} to ${numToIp(f.last)}`).join(", ")}`}>
      <defs>
        <pattern id="sd-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke={D.faint} strokeWidth="2" />
        </pattern>
      </defs>
      {CORRECT_PLAN.map((a) => {
        const d = describe(a.network!, a.prefix!);
        const left = px(oct(d.network));
        const right = px(oct(d.broadcast) + 1);
        return (
          <g key={a.id}>
            <rect x={left} y={50} width={right - left - 1} height={44} rx={4} fill={SEG_COLOR[a.id]} fillOpacity={0.18} stroke={SEG_COLOR[a.id]} />
            {a.id !== "TRANSIT" && (
              <text x={(left + right) / 2} y={70} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
                {a.id}
              </text>
            )}
            {a.id !== "TRANSIT" && (
              <text x={(left + right) / 2} y={85} textAnchor="middle" fill={D.muted} fontSize={9.5} fontFamily="monospace">
                .{oct(d.network)}/{d.prefix}
              </text>
            )}
          </g>
        );
      })}
      {free.map((f) => (
        <rect key={f.first} x={px(oct(numToIp(f.first)))} y={50} width={px(oct(numToIp(f.last)) + 1) - px(oct(numToIp(f.first)))} height={44} rx={4} fill="url(#sd-hatch)" stroke={D.faint} strokeDasharray="4 3" />
      ))}
      <DArrow x1={px(226)} y1={126} x2={px(226)} y2={98} color={D.warning} width={1.5} />
      <text x={px(226)} y={140} textAnchor="middle" fill={D.warning} fontSize={10}>
        transit .224/30
      </text>
      <DArrow x1={px(242)} y1={30} x2={px(242)} y2={48} color={D.faint} width={1.5} />
      <text x={px(242)} y={24} textAnchor="end" fill={D.muted} fontSize={10}>
        free .228–.255 (address space, not one subnet)
      </text>
      {[0, 128, 192, 224, 256].map((o) => (
        <text key={o} x={px(Math.min(o, 255))} y={112} textAnchor={o === 256 ? "end" : "middle"} fill={D.faint} fontSize={9} fontFamily="monospace">
          {o === 256 ? ".255" : `.${o}`}
        </text>
      ))}
      <text x={20} y={176} fill={D.muted} fontSize={10}>
        Largest first: each block starts right after the previous one, and every start is a multiple of its own size.
      </text>
    </DiagramSvg>
  );
}

function BoundaryDiagram() {
  const x0 = 30;
  const w = 580;
  const px = (o: number) => x0 + (o / 256) * w;
  return (
    <DiagramSvg h={170} label="Valid /27 network addresses in the last octet are multiples of 32: 0, 32, 64, 96, 128, 160, 192, 224. 10.44.0.200 falls inside the block starting at 192.">
      {Array.from({ length: 8 }, (_, i) => i * 32).map((o) => (
        <g key={o}>
          <rect x={px(o)} y={50} width={px(o + 32) - px(o) - 2} height={34} rx={3} fill={o === 192 ? D.success : D.box} fillOpacity={o === 192 ? 0.2 : 1} stroke={o === 192 ? D.success : D.line} />
          <text x={px(o) + 3} y={100} fill={D.muted} fontSize={10} fontFamily="monospace">
            .{o}
          </text>
        </g>
      ))}
      <DArrow x1={px(200)} y1={24} x2={px(200)} y2={48} color={D.danger} />
      <text x={px(200) + 6} y={22} fill={D.danger} fontSize={10.5} fontWeight={700}>
        .200 — a host inside .192/27
      </text>
      <text x={30} y={130} fill={D.text} fontSize={10.5}>
        200 AND 224 = 192 · host bits of .200 = 01000 (not all zero), so .200 cannot be a /27 network address.
      </text>
      <text x={30} y={150} fill={D.muted} fontSize={10}>
        The planner rejects 10.44.0.200/27 and names the real network, 10.44.0.192/27. It never silently rewrites it.
      </text>
    </DiagramSvg>
  );
}

function OverlapDiagram() {
  const x0 = 30;
  const w = 580;
  const px = (o: number) => x0 + ((o - 96) / 160) * w;
  return (
    <DiagramSvg h={190} label="LAN-B 10.44.0.128/26 covers .128 to .191; the proposed LAN-C 10.44.0.160/27 covers .160 to .191, entirely inside LAN-B; the correct LAN-C 10.44.0.192/27 starts right after LAN-B">
      <rect x={px(128)} y={30} width={px(192) - px(128)} height={30} rx={4} fill={D.violet} fillOpacity={0.2} stroke={D.violet} />
      <text x={px(160)} y={50} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        LAN-B .128/26 (.128–.191)
      </text>
      <rect x={px(160)} y={76} width={px(192) - px(160)} height={30} rx={4} fill={D.danger} fillOpacity={0.2} stroke={D.danger} strokeDasharray="4 3" />
      <text x={px(176)} y={96} textAnchor="middle" fill={D.danger} fontSize={10} fontWeight={700}>
        proposed .160/27
      </text>
      <rect x={px(192)} y={122} width={px(224) - px(192)} height={30} rx={4} fill={D.success} fillOpacity={0.2} stroke={D.success} />
      <text x={px(208)} y={142} textAnchor="middle" fill={D.success} fontSize={10} fontWeight={700}>
        correct .192/27
      </text>
      {[128, 160, 192, 224].map((o) => (
        <text key={o} x={px(o)} y={176} textAnchor="middle" fill={D.faint} fontSize={9.5} fontFamily="monospace">
          .{o}
        </text>
      ))}
      <text x={px(100)} y={96} fill={D.muted} fontSize={10}>
        aligned, big enough —
      </text>
      <text x={px(100)} y={110} fill={D.danger} fontSize={10} fontWeight={700}>
        but overlapping
      </text>
    </DiagramSvg>
  );
}

function VerifyDiagram() {
  return (
    <DiagramSvg h={240} label={`R1 connected prefixes: ge-0/0/1 ${dA.network}/${dA.prefix}, ge-0/0/2 ${dB.network}/${dB.prefix}, ge-0/0/3 ${dC.network}/${dC.prefix}, ge-0/0/0 ${dT.network}/${dT.prefix} to R2; ICMP Echo tests between all LANs and the transit link`}>
      <DNode x={320} y={120} label="R1" sub="connected only" accent={D.ip} w={110} />
      <DNode x={80} y={40} label="HOST-A" sub={`${SD_ADDR["HOST-A"]}/${dA.prefix}`} accent={SEG_COLOR["LAN-A"]} w={130} />
      <DNode x={80} y={200} label="HOST-B" sub={`${SD_ADDR["HOST-B"]}/${dB.prefix}`} accent={SEG_COLOR["LAN-B"]} w={130} />
      <DNode x={560} y={200} label="HOST-C" sub={`${SD_ADDR["HOST-C"]}/${dC.prefix}`} accent={SEG_COLOR["LAN-C"]} w={130} />
      <DNode x={560} y={40} label="R2" sub={`${SD_ADDR["R2:TRANSIT"]}/${dT.prefix}`} accent={SEG_COLOR.TRANSIT} w={130} />
      <DLink x1={145} y1={50} x2={265} y2={108} color={SEG_COLOR["LAN-A"]} label={`.${oct(dA.network)}/${dA.prefix}`} />
      <DLink x1={145} y1={190} x2={265} y2={132} color={SEG_COLOR["LAN-B"]} label={`.${oct(dB.network)}/${dB.prefix}`} labelDy={16} />
      <DLink x1={375} y1={132} x2={495} y2={190} color={SEG_COLOR["LAN-C"]} label={`.${oct(dC.network)}/${dC.prefix}`} labelDy={16} />
      <DLink x1={375} y1={108} x2={495} y2={50} color={SEG_COLOR.TRANSIT} label={`.${oct(dT.network)}/${dT.prefix}`} />
      <DPill x={320} y={30} text="A→B · B→C · C→A · R1↔R2 all answer" color={D.success} w={260} />
    </DiagramSvg>
  );
}

export function SubnettingLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="sd-mission" eyebrow="This lesson" title="Design, don't just calculate" tone="violet">
        <p>
          IPv4 Addressing &amp; Subnetting showed how one prefix splits an address. This lab goes the other way: you start from what each network needs and design the whole address plan for <Mono>{PARENT.network}/{PARENT.prefix}</Mono>, then prove it with packets.
        </p>
        <Callout tone="violet" title="The four rules of a valid plan">
          Big enough · on a block boundary · inside the parent · overlapping nothing.
        </Callout>
      </GuideSection>

      <GuideSection id="sd-requirements" eyebrow="Requirements" title="From host counts to block sizes" tone="cyan">
        <DiagramFrame caption="Each network gets the smallest block that fits. Some addresses are always left over, because blocks come in powers of two.">
          <RequirementsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sd-powers" eyebrow="Arithmetic" title="Powers of two and host bits" tone="violet">
        <DiagramFrame caption="Ordinary subnets reserve the network (all zeros) and broadcast (all ones) addresses.">
          <PowersDiagram />
        </DiagramFrame>
        <p>
          100 hosts → 7 host bits → <Mono>/25 ({maskOf(25)})</Mono>. 50 → <Mono>/26 ({maskOf(26)})</Mono>. 25 → <Mono>/27 ({maskOf(27)})</Mono>. 2 → <Mono>/30 ({maskOf(30)})</Mono>, the conventional choice here (the Deep Dive covers /31).
        </p>
      </GuideSection>

      <GuideSection id="sd-map" eyebrow="VLSM" title="Largest first, packed on boundaries" tone="success">
        <DiagramFrame caption="The finished plan inside 10.44.0.0/24. The hatched area is free address space.">
          <AddressMapDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="cyan"
          title="The plan"
          mark="→"
          items={CORRECT_PLAN.map((a) => {
            const d = describe(a.network!, a.prefix!);
            return (
              <>
                {a.id}: <Mono>{d.network}/{d.prefix}</Mono>. Hosts {d.firstHost}–{d.lastHost}, broadcast {d.broadcast}, {d.usable} usable.
              </>
            );
          })}
        />
      </GuideSection>

      <GuideSection id="sd-boundaries" eyebrow="Alignment" title="Where a block may start" tone="warning">
        <DiagramFrame caption="A /27 network address is a multiple of 32.">
          <BoundaryDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sd-overlap" eyebrow="Troubleshooting" title="An aligned block can still be wrong" tone="danger">
        <DiagramFrame caption="10.44.0.160/27 passes the boundary and size checks, but fails the overlap check.">
          <OverlapDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Why the candidates fail", tone: "danger", tag: "wrong", points: [".160/27: overlaps LAN-B", ".200/27: not a /27 boundary", ".192/28: 14 hosts < 25"] },
            { title: "Why .192/27 works", tone: "success", tag: "right", points: ["192 = 6 × 32 (aligned)", "30 usable ≥ 25", "Between LAN-B (.191) and transit (.224)"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-verify" eyebrow="Verification" title="A plan is proven with packets" tone="success">
        <DiagramFrame caption="R1 needs only connected routes. Each prefix in the plan carries real ICMP Echo traffic.">
          <VerifyDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Check the arithmetic", body: "Every block is aligned, big enough, and inside the parent.", tone: "cyan" },
            { title: "Check for overlap", body: "Compare every pair of ranges. Routers reject overlapping interface subnets anyway.", tone: "warning" },
            { title: "Deploy and test", body: "Ping across every pair of LANs and across the transit link.", tone: "success" },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-model" eyebrow="Mental model" title="Packing boxes on a shelf" tone="cyan">
        <p>The /24 is a shelf 256 units long. Each network is a box whose size is a power of two, and a box may only sit at a position that is a multiple of its own size. Put the biggest boxes down first and the smaller ones fill in behind them, with no gaps. The space left at the end is still shelf, not a box.</p>
      </GuideSection>

      <GuideSection id="sd-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "VLSM", def: "Variable-Length Subnet Masking: each subnet gets its own prefix length." },
            { term: "Host bits", def: "32 minus the prefix length. 2^h addresses per block." },
            { term: "Block size", def: "Addresses in one subnet. Network addresses are multiples of it." },
            { term: "Ordinary usable hosts", def: "Block size − 2 (network and broadcast), for /30 and shorter." },
            { term: "Overlap", def: "Two subnets sharing any address. Always invalid." },
            { term: "Free space", def: "Unallocated addresses. Not automatically a single valid prefix." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-recap" eyebrow="Recap" title="What you can now do" tone="success">
        <ChecklistCard tone="cyan" title="Subnetting Design Lab" mark="→" items={["Turn a host count into a prefix with 2^h − 2", "Place blocks largest first on aligned boundaries", "Reject misaligned, undersized and overlapping candidates, and explain why", "Describe leftover space as ranges or aligned blocks", "Verify a deployed plan with packets"]} />
      </GuideSection>
    </div>
  );
}
