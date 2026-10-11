import { ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FieldTable, FlowSteps, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { DTable } from "@/components/lesson/FundamentalsGuideSvg";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import type { CliVendor } from "@/lib/cli/types";
import { ipToNum, numToIp } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { CORRECT_PLAN, PARENT, SEGMENTS, blockSize, dA, dB, dC, dT, describe, freeRanges, maskOf, prefixFor } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { createSsState, ssApply, ssRun, type SsAction, type SsState } from "@/lib/sim-engine/scenarios/subnetStudio";
import { ssHostSet, ssR1Sets, type SsCiscoMode, type SsCliApi } from "./subnetting-lab/ssCli";

/**
 * SUBNETTING LESSON GUIDE — the lesson's story on its own network (10.44.0.0/24 for LAN-A, LAN-B, LAN-C and the R1–R2
 * transit link): sizing, boundaries, FLSM vs VLSM, the plan, free space, applying it, then the overlap incident.
 * Every device output comes from the Subnet Explorer's Engineer model (subnetStudio.ts) and its terminals.
 */
export const SD_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "sd-mission", label: "What this lesson teaches" },
  { id: "sd-network", label: "The network of this lesson" },
  { id: "sd-ideas", label: "Three ideas you need" },
  { id: "sd-walk", label: "What you will watch" },
  { id: "sd-requirements", label: "From host counts to blocks" },
  { id: "sd-powers", label: "Host bits and powers of two" },
  { id: "sd-boundaries", label: "Where a block may start" },
  { id: "sd-flsm", label: "FLSM or VLSM" },
  { id: "sd-map", label: "Largest first: the plan" },
  { id: "sd-free", label: "Free space" },
  { id: "sd-apply", label: "From plan to devices" },
  { id: "sd-verify", label: "What working looks like" },
  { id: "sd-incident", label: "The incident" },
  { id: "sd-investigate", label: "Compare real blocks" },
  { id: "sd-repair", label: "Repair and prove it" },
  { id: "sd-other", label: "Other ways a plan breaks" },
  { id: "sd-model", label: "Mental model" },
  { id: "sd-glossary", label: "Glossary" },
  { id: "sd-recap", label: "Recap" },
  { id: "sd-practice", label: "Practice it" },
];

/** The Subnet Explorer's own terminals, run against an Engineer state (a ping typed there runs on a copy). */
function lessonCli(s: SsState, dev: string, vendor: CliVendor, command: string, cisco: SsCiscoMode = { kind: "exec" }) {
  const api: SsCliApi = { view: s, act: (a) => ssApply(s, a), cisco, setCisco: () => undefined, junosEdit: false, setJunosEdit: () => undefined, cand: s.net.r1, setCand: () => undefined, hist: [{ r1: s.net.r1, at: 0, by: "root" }], commit: () => undefined };
  return runGuideCli(dev === "r1" ? ssR1Sets(api)[vendor] : ssHostSet(api, dev), command);
}
/** Write a plan row by row in the Engineer's Design board, then apply it to every device. */
const plan = (rows: [string, number, string][]) => ssRun(createSsState("branch"), ...rows.flatMap(([id, prefix, network]): SsAction[] => [{ type: "size", id, prefix }, { type: "place", id, network }]), { type: "apply" });
const GOOD = plan(CORRECT_PLAN.map((a) => [a.id, a.prefix!, a.network!]));
/** The incident: LAN-C written at 10.44.0.160/27. */
const BROKEN = plan(CORRECT_PLAN.map((a) => [a.id, a.prefix!, a.id === "LAN-C" ? "10.44.0.160" : a.network!]));
const hostIp = (s: SsState, id: string) => s.net.hosts[id]?.ip ?? "";
const HOST_A = hostIp(GOOD, "LAN-A");

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
      <DNode x={80} y={40} label="HOST-A" sub={`${hostIp(GOOD, "LAN-A")}/${dA.prefix}`} accent={SEG_COLOR["LAN-A"]} w={130} />
      <DNode x={80} y={200} label="HOST-B" sub={`${hostIp(GOOD, "LAN-B")}/${dB.prefix}`} accent={SEG_COLOR["LAN-B"]} w={130} />
      <DNode x={560} y={200} label="HOST-C" sub={`${hostIp(GOOD, "LAN-C")}/${dC.prefix}`} accent={SEG_COLOR["LAN-C"]} w={130} />
      <DNode x={560} y={40} label="R2" sub={`${hostIp(GOOD, "TRANSIT")}/${dT.prefix}`} accent={SEG_COLOR.TRANSIT} w={130} />
      <DLink x1={145} y1={50} x2={265} y2={108} color={SEG_COLOR["LAN-A"]} label={`.${oct(dA.network)}/${dA.prefix}`} />
      <DLink x1={145} y1={190} x2={265} y2={132} color={SEG_COLOR["LAN-B"]} label={`.${oct(dB.network)}/${dB.prefix}`} labelDy={16} />
      <DLink x1={375} y1={132} x2={495} y2={190} color={SEG_COLOR["LAN-C"]} label={`.${oct(dC.network)}/${dC.prefix}`} labelDy={16} />
      <DLink x1={375} y1={108} x2={495} y2={50} color={SEG_COLOR.TRANSIT} label={`.${oct(dT.network)}/${dT.prefix}`} />
      <DPill x={320} y={30} text="A→B · B→C · C→A · R1↔R2 all answer" color={D.success} w={260} />
    </DiagramSvg>
  );
}

export function SubnettingLessonGuideContent() {
  const connOk = lessonCli(GOOD, "r1", "cisco", "show ip route connected");
  const pingOk = lessonCli(GOOD, "LAN-C", "cisco", `ping -c 2 ${HOST_A}`);
  const refused = lessonCli(BROKEN, "r1", "cisco", `ip address ${numToIp(ipToNum("10.44.0.160") + 1)} ${maskOf(27)}`, { kind: "if", id: "LAN-C" });
  const briefBad = lessonCli(BROKEN, "r1", "cisco", "show ip interface brief");
  const pingBad = lessonCli(BROKEN, "LAN-C", "cisco", `ping -c 2 ${HOST_A}`);
  const pingBtoC = lessonCli(BROKEN, "LAN-B", "cisco", `ping -n 2 ${hostIp(BROKEN, "LAN-C")}`);
  const pingLines = /PING|Pinging|bytes from|Reply|From|transmitted/;
  const c = describe(dC.network!, dC.prefix!);
  return (
    <div className="space-y-12">
      <GuideSection id="sd-mission" eyebrow="This lesson" title="What this lesson teaches" tone="violet">
        <p>
          A branch office has one address block, <Mono>{PARENT.network}/{PARENT.prefix}</Mono>: 256 addresses. It needs four networks out of it: three LANs of different sizes behind the router R1, and a small link from R1 to R2. Every network needs its own range, and no two ranges may share an address.
        </p>
        <p>
          This lesson shows how to <strong>subnet</strong> that block: you size each network from its host count, place each block on a valid boundary, compare equal-size and right-size plans, read the free space, and apply the plan to the devices. Then one network is written on top of another, and you find out why it fails, fix it, and prove it.
        </p>
        <ChecklistCard
          tone="violet"
          title="By the end of this lesson you can"
          mark="→"
          items={[
            "turn a host count into a prefix, a mask and a block size",
            "say where a block of any size may start, and find its network and broadcast addresses",
            "explain why equal-size subnets can't serve this office, and right-size them instead",
            "describe the free space as the blocks that still fit",
            "find and repair the overlapping plan of this lesson, and prove it with packets",
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="One router, three LANs and a transit link, all addressed out of 10.44.0.0/24. R1 needs only its connected routes.">
          <VerifyDiagram />
        </DiagramFrame>
        <FieldTable
          title="What each network needs"
          columns={["Network", "Addresses needed", "Who is on it", "R1 interface"]}
          rows={[
            ["LAN-A (staff)", String(SEGMENTS[0].hosts), "HOST-A and the staff PCs", "Gi0/1 · ge-0/0/1"],
            ["LAN-B (engineering)", String(SEGMENTS[1].hosts), "HOST-B and the lab machines", "Gi0/2 · ge-0/0/2"],
            ["LAN-C (servers)", String(SEGMENTS[2].hosts), "HOST-C and the servers", "Gi0/3 · ge-0/0/3"],
            ["Transit to R2", String(SEGMENTS[3].hosts), "R1 and R2 only", "Gi0/0 · ge-0/0/0"],
          ]}
        />
        <p className="text-sm text-pv-text-muted">
          Each count already includes R1&apos;s own address on that network. When the plan is applied, R1 takes the first usable address of each block and the hosts follow (the Subnet Explorer numbers them from the block&apos;s start + 10). How a host decides local or remote with its mask was the IPv4 lesson; here we decide what the masks should be.
        </p>
      </GuideSection>

      <GuideSection id="sd-ideas" eyebrow="This lesson" title="Three ideas you need" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Blocks come in powers of two", body: "A prefix leaves h host bits, so its block holds 2^h addresses; an ordinary LAN can use 2^h − 2 of them. Pick the smallest block that fits.", tone: "violet" },
            { title: "A block starts on a multiple of its size", body: "A /27 (32 addresses) starts at .0, .32, .64 … Any other start is just an address inside one of those blocks.", tone: "warning" },
            { title: "Real blocks must never overlap", body: "Every device computes its block from its own address and mask. Two blocks sharing even one address put two networks on the same addresses.", tone: "danger" },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-walk" eyebrow="This lesson" title="What you will watch, step by step" tone="warning">
        <FlowSteps
          steps={[
            { title: "Size", body: "100, 50, 25 and 2 addresses become /25, /26, /27 and /30.", tone: "violet" },
            { title: "Align", body: "Each block may only start on a multiple of its own size.", tone: "warning" },
            { title: "Choose a method", body: "Equal-size subnets can't serve this office; right-size ones can.", tone: "cyan" },
            { title: "Pack", body: "Largest first, each block at its first free boundary.", tone: "success" },
            { title: "Apply and test", body: "R1 and the hosts take addresses from the plan; pings prove it.", tone: "ip" },
            { title: "The incident", body: "LAN-C is written on top of LAN-B. You find out why it fails and fix it.", tone: "danger" },
          ]}
        />
        <p className="text-sm text-pv-text-muted">The sections below walk through each step on this network, in the same order.</p>
      </GuideSection>

      <GuideSection id="sd-requirements" eyebrow="Size" title="From host counts to block sizes" tone="cyan">
        <p>Start from what each network needs, never from a favorite prefix. Each network gets the smallest block that holds it:</p>
        <DiagramFrame caption="Each network gets the smallest block that fits. Some addresses are always left over, because blocks come in powers of two.">
          <RequirementsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sd-powers" eyebrow="Size" title="Host bits and powers of two" tone="violet">
        <p>
          The prefix says how many bits are the network; the rest are host bits. h host bits give 2^h addresses. In an ordinary LAN the first address (host bits all 0) names the network and the last (all 1) is its broadcast, so 2^h − 2 are usable:
        </p>
        <DiagramFrame caption="Each extra host bit doubles the block. /31 and /32 are special cases, covered in the Deep Dive.">
          <PowersDiagram />
        </DiagramFrame>
        <p>
          100 needs 7 host bits (126 usable): <Mono>/25 · {maskOf(25)}</Mono>. 50 needs 6 (62): <Mono>/26 · {maskOf(26)}</Mono>. 25 needs 5 (30): <Mono>/27 · {maskOf(27)}</Mono>. The link needs 2: <Mono>/30 · {maskOf(30)}</Mono>.
        </p>
      </GuideSection>

      <GuideSection id="sd-boundaries" eyebrow="Align" title="Where a block may start" tone="warning">
        <p>A block begins where its host bits are all zero, so its network address is always a multiple of its block size:</p>
        <DiagramFrame caption="A /27 network address is a multiple of 32.">
          <BoundaryDiagram />
        </DiagramFrame>
        <p>
          An address can be <em>inside</em> a block without starting one: <Mono>10.44.0.200</Mono> belongs to <Mono>10.44.0.192/27</Mono>. Writing &quot;10.44.0.200/27&quot; doesn&apos;t create a subnet at .200; every device ANDs it with the mask and gets .192. The block runs from its network address to its broadcast address, one less than the next boundary.
        </p>
      </GuideSection>

      <GuideSection id="sd-flsm" eyebrow="Method" title="FLSM or VLSM: one size, or the right size" tone="cyan">
        <CompareCards
          items={[
            { title: "FLSM: fixed length", tone: "warning", tag: "equal blocks", points: ["Every subnet gets the same prefix: s borrowed bits give 2^s equal subnets", "/26: four blocks of 62. LAN-A (100) doesn't fit", "/25: LAN-A fits, but there are only two subnets for four networks"] },
            { title: "VLSM: variable length", tone: "success", tag: "right-sized", points: ["Each network gets the smallest prefix that holds it", "/25 + /26 + /27 + /30 = 228 of 256 addresses", "Blocks of different sizes sit side by side, each on its own boundary"] },
          ]}
        />
        <p>No equal split can serve one network of 100 and three more, so this office needs VLSM. FLSM is still the right tool when every network really is the same size.</p>
      </GuideSection>

      <GuideSection id="sd-map" eyebrow="Pack" title="Largest first: the plan" tone="success">
        <p>Sort the blocks from largest to smallest and place each at the first free address that is a multiple of its size. The big blocks have the fewest legal starts, so they go first; the small ones fill in behind them without holes.</p>
        <DiagramFrame caption="The finished plan inside 10.44.0.0/24. The hatched area is free address space.">
          <AddressMapDiagram />
        </DiagramFrame>
        <FieldTable
          title="The plan"
          columns={["Network", "Block", "Usable range", "Broadcast", "Usable"]}
          rows={CORRECT_PLAN.map((a) => {
            const d = describe(a.network!, a.prefix!);
            return [a.id, <Mono key="n">{`${d.network}/${d.prefix}`}</Mono>, `${d.firstHost} – ${d.lastHost}`, d.broadcast, String(d.usable)];
          })}
        />
        <p className="text-sm text-pv-text-muted">Largest first is the convenient order, not the only valid one: any plan where every block is big enough, aligned, inside the parent and overlapping nothing is correct.</p>
      </GuideSection>

      <GuideSection id="sd-free" eyebrow="Free space" title="Free addresses are not a free block" tone="warning">
        <p>
          After this plan <Mono>.228–.255</Mono> is free: 28 addresses. As aligned blocks that is <Mono>.228/30 + .232/29 + .240/28</Mono>, so a 14-host network (a /28) still fits at .240, but a /27 never can: it needs 32 addresses starting on a multiple of 32.
        </p>
        <p>
          The count of free addresses is never the answer on its own. A new network needs an <strong>aligned</strong> block of its size that is completely free; small blocks scattered across the free space can leave plenty of addresses and no room.
        </p>
      </GuideSection>

      <GuideSection id="sd-apply" eyebrow="Apply" title="From plan to devices" tone="ip">
        <p>
          A plan only exists on paper until the devices carry it. Each R1 interface takes an address in its block with the block&apos;s mask, and each host takes another, the same mask, and R1&apos;s address as its gateway. From then on every device computes its network from its own address and mask, and R1 builds a connected route from each interface.
        </p>
        <p>
          Notice what the devices never see: the spreadsheet. They don&apos;t know which network was meant to sit where; they only know addresses and masks. Keep that in mind: it is the key to the incident.
        </p>
      </GuideSection>

      <GuideSection id="sd-verify" eyebrow="Verification" title="What working looks like" tone="success">
        <p>A plan is checked twice: on paper, by the four rules, and on the devices, with packets. The commands are only the way to ask; what matters is what each answer proves.</p>
        <FieldTable
          title="Read the plan on paper and on the network"
          columns={["Question", "On paper", "On the devices", "What the answer proves"]}
          rows={[
            ["Big enough?", "2^h − 2 ≥ hosts, row by row", "—", "Every device has an address in its block"],
            ["Aligned and inside the parent?", "start mod block size = 0", <Mono key="1">show ip interface brief / show interfaces terse</Mono>, "R1's addresses sit in the planned blocks"],
            ["No overlap?", "compare real blocks", <Mono key="2">show ip route connected / show route</Mono>, "One connected route per network, none inside another"],
            ["Hosts match the plan?", "same mask, gateway = R1", <Mono key="3">ip addr · ipconfig</Mono>, "Each host computes the planned network"],
            ["Does it carry traffic?", "—", <Mono key="4">ping</Mono>, "Every network reaches every other, both ways"],
          ]}
        />
        <p>With the plan applied, R1 has one connected route per network, exactly the four planned blocks:</p>
        <CliPanel run={{ ...connOk, output: pickLines(connOk.output, /^C /) }} caption="R1 · Cisco IOS · healthy" />
        <p>And a host on LAN-C reaches LAN-A through R1 (ttl 63: one router):</p>
        <CliPanel run={{ ...pingOk, output: pickLines(pingOk.output, pingLines) }} caption="HOST-C · Linux · healthy" />
      </GuideSection>

      <GuideSection id="sd-incident" eyebrow="Incident" title="The incident: LAN-C on top of LAN-B" tone="danger">
        <p>A colleague&apos;s plan is deployed with LAN-C at <Mono>10.44.0.160/27</Mono>. It looks fine on paper: .160 is a multiple of 32, and a /27 holds 30 hosts. After the change, the servers on LAN-C reach nobody, and LAN-B can&apos;t reach them either.</p>
        <DiagramFrame caption="10.44.0.160/27 passes the boundary and size checks, and fails the overlap check: it lies entirely inside LAN-B's .128–.191.">
          <OverlapDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "What should happen", tone: "success", tag: "normal", points: ["LAN-C gets its own block, next to LAN-B", "R1 accepts an address in it on Gi0/3", "LAN-C's hosts reach the other LANs through R1"] },
            { title: "What happens", tone: "danger", tag: "incident", points: ["R1 refuses the address on Gi0/3: it overlaps Gi0/2", "LAN-C's gateway doesn't exist, so LAN-C reaches nobody", "LAN-B's hosts think LAN-C's addresses are local"] },
          ]}
        />
        <CompareCards
          items={[
            { title: "Why it fails", tone: "danger", tag: "cause", points: [".160–.191 is inside LAN-B's block .128–.191", "Two networks can't share addresses: R1 can't tell them apart", "Every device computes the overlap from its own mask"] },
            { title: "What it can't be", tone: "warning", tag: "red herrings", points: ["A boundary error: 160 = 5 × 32, aligned", "A block too small: /27 holds 30 ≥ 25", "A cable or a host fault: the plan itself is wrong"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-investigate" eyebrow="Investigation" title="Compare real blocks, not written starts" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Did R1 accept every interface?", look: "show ip interface brief: Gi0/3 is unassigned. Configuring it gives the reason: overlaps with Gi0/2." },
            { question: "What can LAN-C reach?", look: "Nothing, not even its gateway: the gateway address was never configured." },
            { question: "Which real blocks collide?", look: `LAN-B ${dB.network}/${dB.prefix} runs .128–.191. LAN-C .160/27 runs .160–.191: all of it inside LAN-B.` },
          ]}
        />
        <CliPanel run={refused} caption="R1 · applying LAN-C's address on Gi0/3" />
        <CliPanel run={{ ...briefBad, output: pickLines(briefBad.output, /Interface|0\/[23]/) }} caption="R1 · Gi0/3 has no address" />
        <CliPanel run={{ ...pingBad, output: pickLines(pingBad.output, pingLines) }} caption="HOST-C · it can't even reach its gateway" />
        <CliPanel run={{ ...pingBtoC, output: pickLines(pingBtoC.output, pingLines) }} caption="HOST-B · LAN-C's server looks local to it" note="HOST-B's /26 contains the server's address, so it ARPs for it on LAN-B, where it isn't." />
      </GuideSection>

      <GuideSection id="sd-repair" eyebrow="Repair" title="Repair the plan, re-apply, re-test" tone="success">
        <p>
          The fault is in the plan, so fix the plan, not a device. The next free /27 boundary after LAN-B is <Mono>{c.network}</Mono>: aligned (192 = 6 × 32), big enough (30 ≥ 25), and between LAN-B&apos;s broadcast (.191) and the transit link (.224). Rewrite LAN-C as <Mono>{c.network}/{c.prefix}</Mono> and apply it again:
        </p>
        <CompareCards
          items={[
            { title: "Cisco IOS · R1", tone: "cyan", tag: "Gi0/3", points: ["interface GigabitEthernet0/3", `ip address ${c.firstHost} ${maskOf(c.prefix)}`] },
            { title: "Junos · R1", tone: "violet", tag: "candidate → commit", points: [`set interfaces ge-0/0/3 unit 0 family inet address ${c.firstHost}/${c.prefix}`, "commit"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">LAN-C&apos;s hosts move into the new block too, with gateway {c.firstHost}.</p>
        <ChecklistCard
          tone="success"
          title="The proof"
          mark="✓"
          items={[
            `R1 accepts ${c.firstHost}/${c.prefix} on Gi0/3, and show ip route connected lists ${c.network}/${c.prefix}`,
            "No connected route lies inside another",
            "A fresh ping from HOST-C to HOST-A answers with ttl 63",
            "HOST-B reaches HOST-C through R1, no longer as a local host",
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-other" eyebrow="Troubleshooting" title="Other ways an address plan breaks" tone="warning">
        <p>An overlap is one way for a plan to fail. The Subnet Explorer&apos;s tickets add others, each with its own evidence. The Deep Dive walks through them with real output from R1 and the hosts.</p>
        <CompareCards
          items={[
            { title: "A misaligned start", tone: "danger", tag: "a different block than written", points: ["LAN-B written as .160/26: 160 is not a multiple of 64", "Devices compute .128–.191, which swallows LAN-C", "Same symptoms as an overlap, different cause"] },
            { title: "A host with the wrong mask", tone: "warning", tag: "one host can't leave", points: ["The plan is right, one device isn't", "Too wide a mask makes other LANs look local", "It reaches its gateway, nothing beyond"] },
            { title: "A block too small", tone: "danger", tag: "late devices cut off", points: ["The LAN grew past 2^h − 2", "Devices numbered on land past the broadcast", "They can't even reach their neighbors"] },
            { title: "Fragmented free space", tone: "cyan", tag: "addresses but no room", points: ["Plenty of free addresses", "Small blocks sit on every boundary", "No aligned block of the needed size is free"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-model" eyebrow="Mental model" title="Packing boxes on a shelf" tone="cyan">
        <p>
          The /24 is a shelf 256 units long. Each network is a box whose size is a power of two, and a box may only stand at a position that is a multiple of its own size. Put the biggest boxes down first and the small ones fill in behind them. Two boxes can never stand in the same place, however neatly the labels are written, and the gaps left at the end are only useful if a box of the right size fits exactly.
        </p>
      </GuideSection>

      <GuideSection id="sd-glossary" eyebrow="Glossary" title="Terms used in this lesson" tone="violet">
        <Glossary
          items={[
            { term: "Host bits", def: "32 minus the prefix length. 2^h addresses per block." },
            { term: "Block size", def: "The addresses in one subnet. Network addresses are multiples of it." },
            { term: "Network / broadcast address", def: "The first (host bits 0) and last (host bits 1) address of a block. Not given to devices in an ordinary LAN." },
            { term: "FLSM", def: "Fixed-Length Subnet Masking: every subnet the same size." },
            { term: "VLSM", def: "Variable-Length Subnet Masking: each subnet gets its own prefix length." },
            { term: "Overlap", def: "Two subnets sharing any address. Always invalid." },
            { term: "Free space", def: "Unallocated addresses. Useful only as aligned blocks that are completely free." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-recap" eyebrow="Recap" title="What you can now explain" tone="success">
        <ChecklistCard
          tone="cyan"
          title="Subnetting in this lesson"
          mark="→"
          items={[
            "A host count becomes the smallest block with 2^h − 2 ≥ hosts",
            "A block starts on a multiple of its size and ends at its broadcast address",
            "Unequal networks need VLSM; largest first packs them without holes",
            "Free space counts only as aligned, completely free blocks",
            "Devices carry the plan as addresses and masks; R1 refuses overlapping interfaces",
            "An overlap is fixed in the plan: move the block, re-apply, re-test",
          ]}
        />
      </GuideSection>

      <GuideSection id="sd-practice" eyebrow="Practice" title="Practice it" tone="cyan">
        <p>You now know how to build a plan and how to prove it. The Subnet Explorer takes you from the bits to a real topology:</p>
        <FlowSteps
          steps={[
            { title: "Explore and Calculate", body: "Move the prefix line, see where blocks start, then calculate any address's network, range and broadcast.", tone: "violet" },
            { title: "Plan", body: "FLSM against VLSM, right-size and pack, and why a written start isn't the real block.", tone: "warning" },
            { title: "Engineer (7 tickets)", body: "Design a plan for a real branch, apply it to R1 and the hosts in Cisco, Junos, Linux and Windows terminals, prove it with pings, and troubleshoot broken plans.", tone: "danger" },
          ]}
        />
        <PresentationBridge>Rebuild subnetting from zero (bits, prefixes, masks, block sizes, FLSM and VLSM) in the subnetting presentation.</PresentationBridge>
        <LessonLabBridge />
        <p className="text-sm text-pv-text-muted">For the full course (the capacity ladder, borrowing bits, VLSM step by step, every validation rule, /31 and /32, real output for every ticket, a knowledge check), open the Deep Dive tab.</p>
      </GuideSection>
    </div>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the Subnet Explorer" onPractice={openLab}>
      Same network, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}
