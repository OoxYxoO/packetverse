import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FailureSignatures, Glossary, GuideSection, Misconceptions, Mono, ProtocolStory, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ipToNum, numToIp } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { CORRECT_PLAN, PARENT, SD_ADDR, SEGMENTS, blockSize, dA, dB, dC, dT, describe, freeRanges, maskOf, prefixFor } from "@/lib/sim-engine/scenarios/subnettingDesign";

export const SD_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "sd-mission", label: "The mission" },
  { id: "sd-story", label: "The whole story" },
  { id: "sd-process", label: "The design process" },
  { id: "sd-requirements", label: "Requirements" },
  { id: "sd-powers", label: "Powers of two" },
  { id: "sd-boundaries", label: "Block boundaries" },
  { id: "sd-flsm", label: "FLSM vs VLSM" },
  { id: "sd-map", label: "The address map" },
  { id: "sd-free", label: "Free space" },
  { id: "sd-overlap", label: "Misalignment & overlap" },
  { id: "sd-verify", label: "Verification" },
  { id: "sd-lab", label: "Subnet a real network" },
  { id: "sd-breaks", label: "When it breaks" },
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

const PROCESS: { step: string; do: string; prove: string; mistake: string }[] = [
  { step: "Start with requirements", do: `List every network and how many addresses it needs, router included: ${SEGMENTS.map((x) => `${x.id} ${x.hosts}`).join(", ")}.`, prove: "Every device, router port and growth margin is counted once.", mistake: "Forgetting the router (or counting it twice) shifts a network into the wrong size." },
  { step: "Understand the parent", do: `${PARENT.network}/${PARENT.prefix}: ${blockSize(PARENT.prefix)} addresses, ${PARENT.network}–10.44.0.255.`, prove: "The blocks together never exceed the parent's size.", mistake: "Planning past the parent: addresses you don't own." },
  { step: "Calculate the capacity", do: "For each network: the smallest h with 2^h − 2 ≥ needed.", prove: "100 → h = 7 (126 usable), because h = 6 gives only 62.", mistake: "Using 2^h instead of 2^h − 2: a /27 for 31 devices." },
  { step: "Choose a prefix", do: "prefix = 32 − h: /25, /26, /27, /30.", prove: "The block (2^h) is the smallest power of two that holds needed + 2.", mistake: "Rounding up too far: still valid, but wasted space." },
  { step: "Find valid boundaries", do: "A block of size B may only start at a multiple of B.", prove: "start mod B = 0 (all host bits 0).", mistake: "Starting a /26 at .160: devices compute .128 instead." },
  { step: "Place the subnet", do: "Put it on the first free boundary (largest first is convenient).", prove: "Its real block (address AND mask) is exactly what you wrote.", mistake: "A start that looks like the next one but isn't a boundary." },
  { step: "Calculate its range", do: "Network (host bits 0), first usable, last usable, broadcast (host bits 1).", prove: "broadcast = start + B − 1; the next subnet starts at broadcast + 1.", mistake: "Giving a device the network or broadcast address." },
  { step: "Place the next subnet", do: "Same steps, the next requirement, the next free boundary of ITS size.", prove: "Smaller boundaries always line up with bigger ones.", mistake: "Reusing the previous block's step for a different prefix." },
  { step: "Check for overlap", do: "Compare every pair of REAL blocks.", prove: "No address belongs to two networks. Touching (adjacent) is fine.", mistake: "Comparing written starts instead of real blocks hides overlap." },
  { step: "Check remaining space", do: "List the free ranges and the aligned blocks they hold.", prove: "A future network fits only where an aligned block of its size is completely free.", mistake: "28 free is not a /27; even 56 scattered free addresses may hold no /27." },
  { step: "Verify the whole plan", do: "Big enough · aligned · inside the parent · no overlap · ranges right.", prove: "Each rule passes for a reason you can state, row by row.", mistake: "Trusting a tidy-looking spreadsheet." },
  { step: "Apply it", do: "The router interface gets a usable address of each block; hosts get the same mask and that router address as gateway.", prove: "The router's connected subnets are exactly the plan's blocks.", mistake: "A host mask or gateway that doesn't match the block." },
  { step: "Test it", do: "Ping between every pair of networks, in both directions.", prove: "Every request AND every reply arrives.", mistake: "Stopping at: the router accepted the address." },
];

function DesignProcess() {
  return (
    <ol className="space-y-1.5">
      {PROCESS.map((p, i) => (
        <li key={p.step} className="rounded-lg border border-white/10 px-3 py-2">
          <p className="text-xs font-semibold text-pv-text">
            <span className="pv-mono mr-1.5 text-pv-cyan-soft">{String(i + 1).padStart(2, "0")}</span>
            {p.step}
          </p>
          <div className="mt-0.5 grid gap-x-3 gap-y-0.5 text-[11.5px] leading-snug sm:grid-cols-3">
            <p className="text-pv-text-muted">
              <b className="text-pv-text">Do:</b> {p.do}
            </p>
            <p className="text-pv-text-muted">
              <b className="text-pv-success">Prove it:</b> {p.prove}
            </p>
            <p className="text-pv-text-muted">
              <b className="text-pv-danger">Mistake:</b> {p.mistake}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function SubnettingLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="sd-mission" eyebrow="This lesson" title="Design, don't just calculate" tone="violet">
        <p>
          Calculating one subnet is a skill; designing an address plan is the job. You start from what each network needs, turn it into block sizes, place the blocks on valid boundaries inside <Mono>{PARENT.network}/{PARENT.prefix}</Mono>, verify every rule, apply the plan to the devices and prove it with packets.
        </p>
        <Callout tone="violet" title="The four rules of a valid plan">
          Big enough · on a block boundary · inside the parent · overlapping nothing.
        </Callout>
      </GuideSection>

      <GuideSection id="sd-story" eyebrow="How it works" title="Designing the plan, decision by decision" tone="cyan">
        <ProtocolStory
          problem={<>One block, {PARENT.network}/{PARENT.prefix} (256 addresses), has to serve four networks of different sizes. Every network needs its own subnet, the subnets must not overlap, and each must start on a valid boundary, or devices will compute a different network than the one you planned.</>}
          steps={[
            { actor: "You", action: <>list the requirements: {SEGMENTS.map((s) => `${s.id} ${s.hosts}`).join(", ")} addresses (each count already includes the router interface).</>, tone: "cyan" },
            { actor: "You", action: <>size each one: the smallest block with 2^h − 2 ≥ hosts. {SEGMENTS.map((s) => `${s.id} → /${prefixFor(s.hosts).prefix}`).join(", ")}.</>, why: "network and broadcast addresses are reserved in every ordinary subnet", tone: "violet" },
            { actor: "You", action: "sort largest first and place each block at the first free address that is a multiple of its block size.", why: "big blocks have the fewest legal starting points; smaller ones fit into the gaps after them", tone: "warning" },
            { actor: "Result", action: <>{CORRECT_PLAN.map((a) => `${a.id} ${a.network}/${a.prefix}`).join(" · ")}.</>, changes: "each subnet has a network address (host bits 0), a usable range and a broadcast address (host bits 1)", tone: "success" },
            { actor: "Every device", action: "computes its own network with address AND mask. A block written at a misaligned start is silently a different block, and can overlap a neighbor.", why: "devices never read your spreadsheet, only their own address and mask", tone: "ip" },
            { actor: "You", action: "verify: every block aligned, big enough, inside the parent, and no address in two subnets. Then configure the interfaces and hosts.", tone: "success" },
          ]}
          outcome={<>A valid plan comes from three rules: right size (2^h − 2), right boundary (a multiple of the block size), and no overlap. The incident in this lesson shows the third: <Mono>10.44.0.160/27</Mono> is aligned and big enough, but it sits inside LAN-B. The Subnet Explorer lets you build, break and repair plans like this one.</>}
        />
        <PresentationBridge>New to subnetting? The visual presentation rebuilds it from zero: bits, prefixes, masks, block sizes, FLSM and VLSM.</PresentationBridge>
      </GuideSection>

      <GuideSection id="sd-process" eyebrow="The process" title="Designing an address plan, step by step" tone="violet">
        <p>Follow it in order. Each step has a check that proves it, and a typical mistake that shows what goes wrong when it is skipped.</p>
        <DesignProcess />
        <Callout tone="cyan" title="Every step has a reason">
          The prefix is the smallest that fits because 2^h − 2 must cover the hosts. The start is a multiple of the block because a block begins where its host bits are all 0. The plan is valid because no rule fails, not because it matches an answer key.
        </Callout>
      </GuideSection>

      <GuideSection id="sd-requirements" eyebrow="Requirements" title="From host counts to block sizes" tone="cyan">
        <DiagramFrame caption="Each network gets the smallest block that fits. Some addresses are always left over, because blocks come in powers of two.">
          <RequirementsDiagram />
        </DiagramFrame>
        <p>Each count already includes R1&apos;s own interface on that LAN — don&apos;t add one again. The transit link&apos;s 2 are exactly R1 and R2.</p>
      </GuideSection>

      <GuideSection id="sd-powers" eyebrow="Arithmetic" title="Powers of two and host bits" tone="violet">
        <DiagramFrame caption="Ordinary LAN subnets reserve the network (all zeros) and broadcast (all ones) addresses. /31 and /32 work differently — see the Deep Dive.">
          <PowersDiagram />
        </DiagramFrame>
        <p>
          host bits = 32 − prefix · addresses = 2^host bits · ordinary usable = 2^host bits − 2 · subnets from borrowed bits = 2^borrowed.
        </p>
        <p>
          100 hosts → 7 host bits → <Mono>/25 ({maskOf(25)})</Mono>. 50 → <Mono>/26 ({maskOf(26)})</Mono>. 25 → <Mono>/27 ({maskOf(27)})</Mono>. 2 → <Mono>/30 ({maskOf(30)})</Mono>, the conventional choice here (the Deep Dive covers /31).
        </p>
        <Callout tone="warning" title="Why −2, and when it doesn't apply" icon="!">
          In an ordinary LAN subnet the first address (host bits all 0) names the network and the last (host bits all 1) is the broadcast, so devices get 2^h − 2. A /31 point-to-point link (RFC 3021) uses both of its 2 addresses, and a /32 is a single address: special cases, not ordinary LANs.
        </Callout>
      </GuideSection>

      <GuideSection id="sd-boundaries" eyebrow="Alignment" title="Where a block may start" tone="warning">
        <DiagramFrame caption="A /27 network address is a multiple of 32.">
          <BoundaryDiagram />
        </DiagramFrame>
        <p>
          An address can be <i>inside</i> a subnet without being its network address: <Mono>10.44.0.200</Mono> belongs to <Mono>10.44.0.192/27</Mono>. Writing 10.44.0.200/27 as a network doesn&apos;t create a subnet that starts at .200 — every device ANDs it with the mask and gets .192.
        </p>
      </GuideSection>

      <GuideSection id="sd-flsm" eyebrow="FLSM vs VLSM" title="One size for all, or the right size for each" tone="cyan">
        <CompareCards
          items={[
            { title: "FLSM — fixed length", tone: "warning", tag: "equal blocks", points: ["Every subnet gets the same prefix: borrow s bits → 2^s equal subnets", "/26: four blocks of 62 — LAN-A (100) doesn't fit", "/25: fits LAN-A, but only two subnets for four networks"] },
            { title: "VLSM — variable length", tone: "success", tag: "right-sized", points: ["Each network gets the smallest prefix that holds it", "/25 + /26 + /27 + /30 = 228 of 256", "Blocks of different sizes sit side by side when each starts on its own boundary"] },
          ]}
        />
        <p>Largest first is the convenient order: the biggest blocks have the fewest legal starts, and once they are placed the smaller blocks fill in behind them without holes. Another order can still produce a valid plan — the rules decide, not the order — but it can leave gaps that only small blocks can use.</p>
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



      <GuideSection id="sd-free" eyebrow="Free space" title="Free addresses are not the same as a free block" tone="warning">
        <p>
          After this plan <Mono>.228–.255</Mono> is free: 28 addresses. They hold <Mono>.228/30 + .232/29 + .240/28</Mono>, so a 14-host network (a /28) still fits at .240, but a /27 never can: 28 &lt; 32.
        </p>
        <p>
          Having enough addresses isn&apos;t enough either. If two small /30 links sit in the middle of the free space, 56 free addresses can contain <i>no</i> free /27 at all, because every /27 boundary is blocked. A new network needs an <b>aligned</b> block of its size that is completely free.
        </p>
        <Callout tone="warning" title="How to check" icon="!">
          For a new requirement: find its prefix, list the multiples of its block size inside the free ranges, and keep only those whose whole block is free. None left? Move the small blocks together (or plan them at the end) to open an aligned gap.
        </Callout>
      </GuideSection>

      <GuideSection id="sd-overlap" eyebrow="Troubleshooting" title="Misalignment and overlap" tone="danger">
        <p>
          The classic incident: a spreadsheet lists LAN-C <Mono>10.44.0.128/27</Mono> and LAN-B <Mono>10.44.0.160/26</Mono>. On paper they sit side by side. But .160 isn&apos;t a /26 boundary (/26 blocks start at .0 .64 .128 .192): every LAN-B device computes 160 AND 192 = <b>128</b>, so LAN-B really is <Mono>.128–.191</Mono>, on top of LAN-C.
        </p>
        <CompareCards
          items={[
            { title: "Root cause", tone: "danger", tag: "the one wrong number", points: ["Invalid subnet boundary: .160 written for a /26", "160 mod 64 = 32, not 0"] },
            { title: "Consequences", tone: "warning", tag: "what you observe", points: ["Overlap: LAN-B's real block contains all of LAN-C", "R1 refuses the second interface (overlaps with …)", "A LAN-B host decides LAN-C hosts are LOCAL and ARPs on the wrong wire"] },
          ]}
        />
        <p>Fixing a consequence (moving an interface, adding a route) doesn&apos;t fix the plan. Fix the boundary, re-check overlap, re-apply, re-test.</p>
        <p className="pt-2 text-sm font-semibold text-pv-text">An aligned block can still be wrong</p>
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
        <ChecklistCard
          tone="success"
          title="Before you call a plan finished"
          mark="?"
          items={["Does every requirement fit? (2^h − 2 ≥ hosts, row by row)", "Is every network start aligned? (start mod block = 0)", "Is every block inside the parent?", "Do any two real blocks overlap? (adjacent is fine)", "Are the network and broadcast addresses right for each block?", "Is each gateway inside its own subnet, and is it the router's address there?", "How much space remains, and as which aligned blocks?", "Could the remaining space hold the next requirement?"]}
        />
        <Callout tone="cyan" title="Accepted is not proven">
          A router accepting an address only proves it didn&apos;t overlap another interface. Compare the router&apos;s connected subnets with the plan, check each host&apos;s mask and gateway, then ping every pair of networks in both directions.
        </Callout>
      </GuideSection>

      <GuideSection id="sd-lab" eyebrow="Hands-on" title="Subnet a real network" tone="cyan">
        <p>
          A plan is finished when the network proves it. In the lab&apos;s <b>Branch network lab</b> you get a topology — R1, four switched LANs (Staff 100, Lab 50, Servers 20, Management 6, each count with R1 included) with their PCs and servers, and a WAN link to the ISP — and one parent block, <Mono>172.20.8.0/24</Mono>.
        </p>
        <TroubleshootingFlow
          steps={[
            { question: "Read the requirements", look: "Each LAN in the topology shows how many addresses it needs; the link needs 2." },
            { question: "Calculate and design", look: "Smallest block per LAN, placed on its own boundary inside the /24. Any valid plan is accepted." },
            { question: "Assign the blocks to the topology", look: "Each LAN in the topology now carries its block, in the same color as the address board." },
            { question: "Configure R1", look: "One usable address of each block per interface, with the block's mask (Configure tab, Cisco IOS or Junos)." },
            { question: "Configure every device", look: "An unused usable address of its LAN's block, the same mask, R1's address on that LAN as gateway (settings, ip addr/ip route, netsh)." },
            { question: "Test, and watch the packets", look: "Test all paths: every device to every other. Each ping plays on the topology: ARP, the gateway, R1's new frame, the reply." },
            { question: "Investigate a failure", look: "Which device decided what (its own AND), which ARP went unanswered, which route R1 lacked." },
            { question: "Fix the plan or the configuration, test again", look: "Until every path is answered by the right device after your last change." },
          ]}
        />
        <CompareCards
          items={[
            { title: "Is the plan valid?", tone: "violet", tag: "the math", points: ["Every block big enough, aligned, inside the parent, no overlap", "Checked in Design → Verify"] },
            { title: "Did I apply it correctly?", tone: "cyan", tag: "the devices", points: ["Every interface and host inside its block, same mask, right gateway, no duplicates", "Checked in Build & test — then proven with traffic"] },
          ]}
        />
        <Callout tone="warning" title="A valid plan can still be configured wrongly" icon="!">
          And a configuration the devices accept can still violate the plan: R1 accepted <Mono>/26</Mono> on the Staff interface in one ticket, and half of Staff lost its way back.
        </Callout>
      </GuideSection>

      <GuideSection id="sd-breaks" eyebrow="When it breaks" title="Troubleshooting addressing from evidence" tone="danger">
        <p>When a host can&apos;t reach another network, derive the mistake instead of guessing. Each question uses evidence you can read from the devices and the plan.</p>
        <TroubleshootingFlow
          steps={[
            { question: "What exactly fails?", look: "Which source, which destination, both directions? Does the host still reach its own gateway?" },
            { question: "Check the host's IP and mask", look: "ipconfig / ip addr: the address, the mask, the gateway." },
            { question: "Which network does the host believe it is in?", look: "Its address AND its OWN mask. Compare with the plan's block for that LAN." },
            { question: "Which network is the destination in?", look: "The destination AND the source's mask: through the source's eyes." },
            { question: "Local or remote?", look: "Same result → it ARPs for the destination directly. Different → it must use a gateway inside its own subnet." },
            { question: "Do these subnets actually overlap?", look: "Compare REAL blocks, not written starts." },
            { question: "Is each network address aligned?", look: "start mod block size = 0? If not, the real block is somewhere else." },
            { question: "What does the mask really mean?", look: "/24 vs /27 is 256 vs 32 addresses: a wider mask makes far-away hosts look local." },
            { question: "Root cause", look: "The one wrong number. Overlap, a refused interface and a wrong local decision are usually its consequences." },
            { question: "Redesign or correct, then verify", look: "Fix the plan (or the device), re-apply, re-run every rule and every ping." },
          ]}
        />
        <FailureSignatures
          items={[
            { tag: "1", title: "Misaligned network", tone: "danger", points: ["Written start isn't a multiple of the block", "The real block lands on a neighbor: overlap", "The router refuses the second interface"] },
            { tag: "2", title: "Wrong host mask", tone: "warning", points: ["Reaches its gateway, not other LANs", "Decides remote hosts are LOCAL", "Replies to it fail the same way"] },
            { tag: "3", title: "Gateway outside the subnet", tone: "warning", points: ["Local traffic works", "Nothing remote: the gateway isn't on its network", "Linux refuses the default route"] },
            { tag: "4", title: "Fragmented free space", tone: "cyan", points: ["Plenty of addresses free", "No aligned block of the needed size", "Small blocks sit on every boundary"] },
            { tag: "5", title: "Block too small", tone: "danger", points: ["The LAN has more devices than 2^h − 2", "Later devices get addresses past the block", "They see their own gateway as foreign"] },
            { tag: "6", title: "Duplicate address", tone: "warning", points: ["Two devices answer the same ARP", "Replies come from the wrong device", "The last ARP reply wins"] },
            { tag: "7", title: "Router interface mask wrong", tone: "warning", points: ["R1's connected route is narrower than the block", "Hosts outside it reach R1, but R1 has no route back", "Part of the LAN works, part doesn't"] },
          ]}
        />
        <Misconceptions
          items={[
            { myth: "Largest first is the only correct way.", correction: "It's the convenient way. Any plan where every rule holds is valid." },
            { myth: "28 free addresses means a /27 still fits.", correction: "A /27 needs 32 addresses starting on a multiple of 32, all free." },
            { myth: "10.44.0.200/27 is a new subnet at .200.", correction: "It's a host inside 10.44.0.192/27." },
            { myth: "10.44.0.0/24 is a Class C network.", correction: "Classes are history (its first octet is even old Class A space). It's simply a /24." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-model" eyebrow="Mental model" title="Packing boxes on a shelf" tone="cyan">
        <p>The /24 is a shelf 256 units long. Each network is a box whose size is a power of two, and a box may only sit at a position that is a multiple of its own size. Put the biggest boxes down first and the smaller ones fill in behind them, with no gaps — the convenient order, though other orders can also fit if you track the gaps they leave. The space left at the end is still shelf, not a box.</p>
      </GuideSection>

      <GuideSection id="sd-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "VLSM", def: "Variable-Length Subnet Masking: each subnet gets its own prefix length." },
            { term: "Host bits", def: "32 minus the prefix length. 2^h addresses per block." },
            { term: "Block size", def: "Addresses in one subnet. Network addresses are multiples of it." },
            { term: "Ordinary usable hosts", def: "Block size − 2 (network and broadcast), for ordinary LAN subnets /30 and shorter. /31 (RFC 3021) and /32 differ." },
            { term: "Overlap", def: "Two subnets sharing any address. Always invalid." },
            { term: "Free space", def: "Unallocated addresses. Not automatically a single valid prefix." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-recap" eyebrow="Recap" title="What you can now do" tone="success">
        <LessonLabBridge />
        <ChecklistCard tone="cyan" title="Subnetting Design Lab" mark="→" items={["Explain why /24 = 256, /25 = 128, /26 = 64 from host bits, not memory", "Calculate network, first, last, broadcast and usable for any address and prefix", "Turn a host count (router included) into a prefix with 2^h − 2", "Place blocks on aligned boundaries, largest first or any valid order", "Reject misaligned, undersized, outside and overlapping blocks, and say why", "Describe free space as aligned blocks, and say what can still fit", "Apply a plan to a router and hosts, then prove it with pings", "Troubleshoot a symptom back to its root cause"]} />
      </GuideSection>
    </div>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Subnet Explorer" onPractice={openLab}>
      Practice it: explore the address board, calculate subnets yourself, then subnet a real branch network — design the plan, configure R1 and every PC and server from it, watch the packets, and solve seven addressing tickets. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}
