import type { ReactNode } from "react";
import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, FailureSignatures, FieldTable, FlowSteps, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DFieldRow } from "@/components/lesson/FundamentalsGuideSvg";
import { ExplainIt, KnowledgeCheck, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { numToIp } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { CORRECT_PLAN, PARENT, SEGMENTS, blockSize, maskOf, overlaps, prefixFor } from "@/lib/sim-engine/scenarios/subnettingDesign";
import { SL_CALC, SL_INCIDENT_PLAN, SL_LAN_D, capacityLadder, dotOct, lastOctet, equalSplit, firstFit, holes, incidentSymptom, octetBits, planReport, rangeLabel, slUsable, subnetCalc, validateRow, type SlRow } from "@/lib/sim-engine/scenarios/subnettingLab";

/**
 * SUBNETTING DESIGN DEEP DIVE — the complete lesson on THIS address space: parent 10.44.0.0/24, LAN-A 100, LAN-B 50,
 * LAN-C 25 (each count includes R1's interface) and the R1 ↔ R2 transit link 2. Every plan, range, verdict, free
 * block and symptom below is produced by the guided lesson's arithmetic and the Subnet Design Studio's validator —
 * nothing is hand-typed. The 2^h − 2 rule is scoped to ordinary LAN subnets throughout; /31 and /32 get their own
 * section. Routing, aggregation, IPv6 and IPAM stay in "Beyond this lesson".
 */

const G = { foundation: "Foundation", one: "Designing one subnet", flsm: "Equal-size subnetting", vlsm: "VLSM", valid: "Validation", special: "Special prefixes", ops: "Operations", master: "Master it", beyond: "Beyond this lesson" };

export const SD_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "sdd-why", label: "Why subnetting exists", group: G.foundation },
  { id: "sdd-prefix", label: "What the prefix means", group: G.foundation },
  { id: "sdd-requirements", label: "Host requirements", group: G.foundation },
  { id: "sdd-powers", label: "Powers of two", group: G.foundation },
  { id: "sdd-ladder", label: "The capacity ladder", group: G.one },
  { id: "sdd-hostbits", label: "Host bits → prefix and mask", group: G.one },
  { id: "sdd-usable", label: "Total vs usable", group: G.one },
  { id: "sdd-block", label: "Block size", group: G.one },
  { id: "sdd-boundary", label: "Valid boundaries", group: G.one },
  { id: "sdd-network", label: "Network address", group: G.one },
  { id: "sdd-firstlast", label: "First and last usable", group: G.one },
  { id: "sdd-broadcast", label: "Broadcast", group: G.one },
  { id: "sdd-next", label: "Next subnet", group: G.one },
  { id: "sdd-borrow", label: "Borrowing bits", group: G.flsm },
  { id: "sdd-count", label: "Subnet count", group: G.flsm },
  { id: "sdd-equal", label: "Equal splits of the /24", group: G.flsm },
  { id: "sdd-flsm-fails", label: "Why FLSM can't fit this design", group: G.flsm },
  { id: "sdd-why-vlsm", label: "Why VLSM", group: G.vlsm },
  { id: "sdd-size-all", label: "Size every requirement", group: G.vlsm },
  { id: "sdd-largest", label: "The largest-first method", group: G.vlsm },
  { id: "sdd-convenient", label: "Why largest-first is convenient", group: G.vlsm },
  { id: "sdd-allocate", label: "Allocation walk-through", group: G.vlsm },
  { id: "sdd-free", label: "Free space as ranges", group: G.vlsm },
  { id: "sdd-free-blocks", label: "Aligned blocks in free space", group: G.vlsm },
  { id: "sdd-landd", label: "Fitting LAN-D", group: G.vlsm },
  { id: "sdd-overlap", label: "Overlap", group: G.valid },
  { id: "sdd-diff-mask", label: "Overlap across different masks", group: G.valid },
  { id: "sdd-misaligned", label: "Misalignment and the real block", group: G.valid },
  { id: "sdd-contain", label: "Containment", group: G.valid },
  { id: "sdd-small", label: "Too small", group: G.valid },
  { id: "sdd-oversized", label: "Oversized (advisory)", group: G.valid },
  { id: "sdd-whole", label: "Whole-plan validation", group: G.valid },
  { id: "sdd-31-32", label: "/31 and /32", group: G.special },
  { id: "sdd-read", label: "Reading a plan", group: G.ops },
  { id: "sdd-incident", label: "The flawed-plan incident", group: G.ops },
  { id: "sdd-workflow", label: "Troubleshooting workflow", group: G.ops },
  { id: "sdd-signatures", label: "Failure signatures", group: G.ops },
  { id: "sdd-myths", label: "Common misconceptions", group: G.master },
  { id: "sdd-quiz", label: "Knowledge check", group: G.master },
  { id: "sdd-challenge", label: "Design challenge", group: G.master },
  { id: "sdd-explain", label: "Can you explain it?", group: G.master },
  { id: "sdd-practice", label: "Practise in the Studio", group: G.master },
  { id: "sdd-beyond", label: "Aggregation, IPv6, IPAM…", group: G.beyond },
];

// ------------------------------------------------------------------ one source of truth: the lesson + lab models

const P = `${PARENT.network}/${PARENT.prefix}`;
const PSIZE = blockSize(PARENT.prefix);
const seg = (id: string) => SEGMENTS.find((s) => s.id === id)!;
const minP = (h: number) => prefixFor(h).prefix;
const rowsOf = (plan: { id: SlRow["id"]; prefix?: number; network?: string }[]): SlRow[] => plan.map((a) => ({ id: a.id, hosts: a.id === "LAN-D" ? SL_LAN_D.hosts : seg(a.id).hosts, prefix: a.prefix, network: a.network }));
const REF: SlRow[] = rowsOf(CORRECT_PLAN);
const REF_REPORT = planReport(REF);
const REF_FREE = REF_REPORT.space.ranges[0];
/** Smallest-first with the same placement rule (lowest free aligned block), built by the Studio's firstFit. */
const SMALL_FIRST: SlRow[] = [...SEGMENTS]
  .sort((a, b) => a.hosts - b.hosts)
  .reduce<SlRow[]>((rows, s) => [...rows, { id: s.id, hosts: s.hosts, prefix: minP(s.hosts), network: firstFit(rows, s.id, s.hosts)!.network }], []);
const SMALL_REPORT = planReport(SMALL_FIRST);
const SMALL_HOLES = holes(SMALL_FIRST);
const CALC = subnetCalc(SL_CALC.address, SL_CALC.prefix);
const SPLITS = [25, 26, 27].map(equalSplit);
const LAN_D_FIT = firstFit(REF, "LAN-D", SL_LAN_D.hosts)!;
const withD = (o: string): SlRow[] => [...REF, { id: "LAN-D", hosts: SL_LAN_D.hosts, prefix: minP(SL_LAN_D.hosts), network: o }];
const D_BAD = validateRow(withD(numToIp(REF_FREE.first)), "LAN-D")!;
const D_GOOD = validateRow(withD(LAN_D_FIT.network), "LAN-D")!;
const INC: SlRow[] = rowsOf(SL_INCIDENT_PLAN);
const INC_B = validateRow(INC, "LAN-B")!;
const INC_C = validateRow(INC, "LAN-C")!;
const INC_SYM = incidentSymptom(INC)!;
const FIX: SlRow[] = INC.map((r) => ({ ...r, network: CORRECT_PLAN.find((a) => a.id === r.id)!.network }));
const FIX_SYM = incidentSymptom(FIX)!;
const ALT_NETS: Record<string, string> = { "LAN-A": "10.44.0.0", "LAN-B": "10.44.0.192", "LAN-C": "10.44.0.128", TRANSIT: "10.44.0.160" };
const ALT_FIX: SlRow[] = INC.map((r) => ({ ...r, network: ALT_NETS[r.id] }));
const ALT_OK = planReport(ALT_FIX).allValid;
const OVL = validateRow(rowsOf([{ id: "LAN-B", prefix: 26, network: "10.44.0.128" }, { id: "LAN-C", prefix: 27, network: "10.44.0.160" }]), "LAN-C")!;
const SMALL_C = validateRow(rowsOf([{ id: "LAN-C", prefix: 28, network: "10.44.0.192" }]), "LAN-C")!;
const BIG_C = validateRow(rowsOf([{ id: "LAN-C", prefix: 26, network: "10.44.0.192" }]), "LAN-C")!;
const OUT_C = validateRow(rowsOf([{ id: "LAN-C", prefix: 27, network: "10.44.1.0" }]), "LAN-C")!;
const MULTI = validateRow(rowsOf([{ id: "LAN-C", prefix: 28, network: "10.44.0.200" }]), "LAN-C")!;
const codes = (c: { violations: { code: string; with?: string }[] }) => c.violations.map((v) => (v.with ? `${v.code} (${v.with})` : v.code)).join(" + ") || "VALID";
const C_LADDER = capacityLadder(seg("LAN-C").hosts);
const COLOR: Record<string, string> = { "LAN-A": D.cyan, "LAN-B": D.violet, "LAN-C": D.success, TRANSIT: D.warning, "LAN-D": "#f472b6" };
const SHORT: Record<string, string> = { "LAN-A": "A", "LAN-B": "B", "LAN-C": "C", TRANSIT: "T", "LAN-D": "D" };
const Strong = ({ children }: { children: ReactNode }) => <b className="text-pv-text">{children}</b>;

function LabBridge({ label, children }: { label: string; children: ReactNode }) {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label={label} onPractice={openLab}>
      {children}
    </PracticeBridge>
  );
}

// ------------------------------------------------------------------ diagrams (all driven by the rows passed in)

/** A 0–255 bar of a plan: real blocks (or written ranges), free space hatched, overlap red. */
function PlanBar({ rows, label, written = false, h = 96 }: { rows: SlRow[]; label: string; written?: boolean; h?: number }) {
  const x0 = 20;
  const w = 600;
  const px = (o: number) => x0 + (o / PSIZE) * w;
  const report = planReport(rows);
  const checks = rows.map((r) => validateRow(rows, r.id)).filter((c): c is NonNullable<typeof c> => !!c);
  const lanes: { first: number; last: number }[][] = [];
  const laneOf = new Map<string, number>();
  for (const c of [...checks].sort((a, b) => a.realRange.first - b.realRange.first)) {
    const r = written ? c.writtenRange : c.realRange;
    let i = 0;
    while (lanes[i]?.some((o) => overlaps(r, o))) i++;
    (lanes[i] ??= []).push(r);
    laneOf.set(c.id, i);
  }
  const off = (n: number) => n % PSIZE;
  return (
    <DiagramSvg h={h} label={`${label}: ${checks.map((c) => `${c.id} ${rangeLabel(written ? c.writtenRange : c.realRange)}`).join(", ")}`}>
      <defs>
        <pattern id={`sdd-hatch-${label.length}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" stroke={D.faint} strokeWidth="2" />
        </pattern>
      </defs>
      {!written &&
        report.space.ranges.map((f) => <rect key={f.first} x={px(off(f.first))} y={18} width={px(off(f.last) + 1) - px(off(f.first))} height={28} fill={`url(#sdd-hatch-${label.length})`} stroke={D.faint} strokeDasharray="3 3" />)}
      {checks.map((c) => {
        const r = written ? c.writtenRange : c.realRange;
        const lane = laneOf.get(c.id) ?? 0;
        const y = 18 + lane * 32;
        const left = px(off(r.first));
        const width = Math.max(2, px(off(r.last) + 1) - left - 1);
        return (
          <g key={c.id}>
            <rect x={left} y={y} width={width} height={28} rx={3} fill={COLOR[c.id]} fillOpacity={0.2} stroke={COLOR[c.id]} strokeDasharray={written || c.aligned ? undefined : "4 3"} />
            <text x={left + width / 2} y={y + 18} textAnchor="middle" fill={D.text} fontSize={width > 40 ? 10 : 9} fontWeight={700}>
              {width > 40 ? `${SHORT[c.id]} ${dotOct(written ? c.written : c.real)}/${c.prefix}` : SHORT[c.id]}
            </text>
          </g>
        );
      })}
      {!written &&
        report.overlaps.map((o) => (
          <rect key={`${o.a}${o.b}`} x={px(off(o.shared!.first))} y={14} width={px(off(o.shared!.last) + 1) - px(off(o.shared!.first))} height={h - 40} fill={D.danger} fillOpacity={0.18} stroke={D.danger} strokeDasharray="2 2" />
        ))}
      {[0, 64, 128, 192, 256].map((o) => (
        <text key={o} x={px(o)} y={h - 6} textAnchor={o === 0 ? "start" : o === 256 ? "end" : "middle"} fill={D.faint} fontSize={9} fontFamily="monospace">
          {o === 256 ? ".255" : `.${o}`}
        </text>
      ))}
    </DiagramSvg>
  );
}

function BinaryMasksDiagram() {
  const rows = [25, 26, 27, 28, 30];
  return (
    <DiagramSvg h={226} label={`Last octet of each mask in binary: ${rows.map((p) => `/${p} ${maskOf(p).split(".")[3]}`).join(", ")}`}>
      {rows.map((p, i) => {
        const bits = Number(maskOf(p).split(".")[3]).toString(2).padStart(8, "0").split("");
        const y = 14 + i * 40;
        return (
          <g key={p}>
            <text x={20} y={y + 20} fill={D.text} fontSize={11} fontWeight={700} fontFamily="monospace">
              /{p}
            </text>
            <text x={66} y={y + 20} fill={D.muted} fontSize={10} fontFamily="monospace">
              {maskOf(p)}
            </text>
            <DFieldRow x={230} y={y} h={30} fields={bits.map((b) => ({ label: b, w: 36, color: b === "1" ? D.violet : D.success }))} />
            <text x={530} y={y + 20} fill={D.muted} fontSize={10}>
              block {blockSize(p)}
            </text>
          </g>
        );
      })}
    </DiagramSvg>
  );
}

function BinaryAddress({ ip, prefix, caption }: { ip: string; prefix: number; caption: string }) {
  const b = octetBits(ip, prefix);
  const row = (y: number, label: string, bits: string, netColor: string, hostColor: string) => (
    <g>
      <text x={20} y={y + 20} fill={D.muted} fontSize={10} fontFamily="monospace">
        {label}
      </text>
      <DFieldRow x={170} y={y} h={30} fields={bits.split("").map((x, i) => ({ label: x, w: 40, color: i < b.net.length ? netColor : hostColor }))} />
    </g>
  );
  return (
    <DiagramSvg h={150} label={`${caption}: last octet ${b.bits}, network bits ${b.net}, host bits ${b.host}; AND the mask gives ${b.anded}`}>
      {row(8, `${dotOct(ip)} (/${prefix})`, b.bits, D.violet, D.success)}
      {row(46, `mask .${b.maskOctet}`, b.maskOctet.toString(2).padStart(8, "0"), D.line, D.line)}
      {row(84, `AND = .${b.anded}`, b.anded.toString(2).padStart(8, "0"), D.violet, D.success)}
      <text x={20} y={140} fill={D.text} fontSize={10.5}>
        host bits {b.host} → {/^0*$/.test(b.host) ? "all 0: a network address" : `not all 0: a host inside .${b.anded}/${prefix}`}
      </text>
    </DiagramSvg>
  );
}

function FreeSpaceDiagram() {
  const f = REF_FREE;
  const lo = f.first % PSIZE;
  const px = (o: number) => 60 + ((o - 224) / 32) * 520;
  return (
    <DiagramSvg h={150} label={`Free range ${rangeLabel(f)} decomposes into the aligned blocks ${f.blocks.map((b) => `${b.network}/${b.prefix}`).join(", ")}`}>
      <rect x={px(224)} y={30} width={px(lo) - px(224) - 1} height={30} rx={3} fill={D.warning} fillOpacity={0.2} stroke={D.warning} />
      <text x={(px(224) + px(lo)) / 2} y={50} textAnchor="middle" fill={D.warning} fontSize={9}>
        T
      </text>
      {f.blocks.map((b) => {
        const s = Number(b.network.split(".")[3]);
        const e = s + blockSize(b.prefix);
        return (
          <g key={b.network}>
            <rect x={px(s)} y={30} width={px(e) - px(s) - 1} height={30} rx={3} fill={D.box} stroke={D.faint} strokeDasharray="4 3" />
            <text x={(px(s) + px(e)) / 2} y={50} textAnchor="middle" fill={D.text} fontSize={10} fontFamily="monospace">
              .{s}/{b.prefix}
            </text>
          </g>
        );
      })}
      {[224, lo, ...f.blocks.slice(1).map((b) => Number(b.network.split(".")[3])), 256].map((o) => (
        <text key={o} x={px(o)} y={78} textAnchor="middle" fill={D.faint} fontSize={9} fontFamily="monospace">
          {o === 256 ? "256" : `.${o}`}
        </text>
      ))}
      <text x={60} y={110} fill={D.text} fontSize={10.5}>
        {rangeLabel(f)} = {f.last - f.first + 1} addresses: not a power of two, so not one prefix.
      </text>
      <text x={60} y={130} fill={D.muted} fontSize={10}>
        It still holds aligned blocks: {f.blocks.map((b) => `${dotOct(b.network)}/${b.prefix}`).join(" + ")}.
      </text>
    </DiagramSvg>
  );
}

function Slash31Diagram() {
  return (
    <DiagramSvg h={170} label="A /30 transit link uses 4 addresses, network and broadcast reserved, two usable; a /31 point-to-point link per RFC 3021 uses 2 addresses, both usable, with no network or broadcast reservation">
      <text x={20} y={24} fill={D.warning} fontSize={11} fontWeight={700}>
        /30 (this plan)
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
        2 of 2 usable — the minus-2 rule does not apply
      </text>
    </DiagramSvg>
  );
}

function Slash32Diagram() {
  return (
    <DiagramSvg h={150} label="A /32 identifies exactly one address, used for loopbacks and host routes; it is a route to one address, not a subnet of hosts">
      <DNode x={120} y={70} label="R1 loopback" sub="10.44.1.1/32" accent={D.cyan} w={140} />
      <DNode x={460} y={70} label="R2" sub="route 10.44.1.1/32 → R1" accent={D.ip} w={170} />
      <DArrow x1={375} y1={70} x2={192} y2={70} color={D.cyan} label="exactly one address" />
      <text x={20} y={130} fill={D.muted} fontSize={10}>
        Block size 1: no host range, no network or broadcast address. (Illustrative address outside this lesson&apos;s /24.)
      </text>
    </DiagramSvg>
  );
}

function AggregationDiagram() {
  const lans = CORRECT_PLAN.filter((a) => a.id !== "TRANSIT");
  return (
    <DiagramSvg h={190} label={`R1 owns ${lans.map((a) => `${a.network}/${a.prefix}`).join(", ")}; because the plan was carved from one parent, a distant router can reach them all with the single summary ${P}`}>
      {lans.map((a, i) => (
        <g key={a.id}>
          <DNode x={100 + i * 150} y={40} label={`${a.network}/${a.prefix}`} w={140} accent={D.violet} />
          <DArrow x1={100 + i * 150} y1={62} x2={300} y2={112} color={D.muted} width={1.4} />
        </g>
      ))}
      <DNode x={300} y={134} label={P} sub="one summary" w={200} accent={D.success} />
      <DLink x1={400} y1={134} x2={520} y2={134} color={D.success} />
      <DPill x={570} y={134} text="far router" color={D.ip} w={90} />
    </DiagramSvg>
  );
}

// ------------------------------------------------------------------ knowledge checks

const Q_PREFIX: KnowledgeQuestion = {
  id: "sdd-q-prefix",
  prompt: "LAN-B needs 50 addresses (R1 included). Which is the smallest prefix that fits?",
  options: [
    { id: "27", label: "/27" },
    { id: "25", label: "/25" },
    { id: "26", label: "/26" },
    { id: "28", label: "/28" },
  ],
  correctId: String(minP(50)),
  explanation: `2^5 − 2 = 30 < 50 ≤ 2^6 − 2 = 62 → 6 host bits → /${minP(50)}.`,
};
const QUIZ: KnowledgeQuestion[] = [
  { id: "sdd-quiz-1", prompt: `Which of these is a valid /27 network address?`, options: [{ id: "200", label: "10.44.0.200" }, { id: "176", label: "10.44.0.176" }, { id: "224", label: "10.44.0.224" }, { id: "100", label: "10.44.0.100" }], correctId: "224", explanation: "Only multiples of 32 start a /27: 224 = 7 × 32. 200, 176 and 100 are host addresses inside other /27 blocks." },
  { id: "sdd-quiz-2", prompt: `What is the broadcast address of ${CALC.network}/${CALC.prefix}?`, options: [{ id: "255", label: "10.44.0.255" }, { id: "bc", label: CALC.broadcast }, { id: "222", label: CALC.last }, { id: "224", label: CALC.next }], correctId: "bc", explanation: `All host bits 1: ${CALC.broadcast}. ${CALC.last} is the last usable address and ${CALC.next} is the next subnet.` },
  { id: "sdd-quiz-3", prompt: "Do 10.44.0.128/26 and 10.44.0.192/27 overlap?", options: [{ id: "yes", label: "Yes — they touch" }, { id: "no", label: "No" }, { id: "mask", label: "Can't tell: the masks differ" }, { id: "always", label: "Yes — different masks always overlap" }], correctId: "no", explanation: ".128/26 ends at .191 and .192/27 starts at .192. Touching is not sharing; the masks being different is irrelevant." },
  { id: "sdd-quiz-4", prompt: "Is the smallest-first plan (Transit .0/30, LAN-C .32/27, LAN-B .64/26, LAN-A .128/25) valid?", options: [{ id: "no-order", label: "No — smallest-first is never valid" }, { id: "no-overlap", label: "No — it overlaps" }, { id: "yes", label: "Yes" }, { id: "no-space", label: "No — it runs out of space" }], correctId: SMALL_REPORT.allValid ? "yes" : "no-overlap", explanation: `Every block is aligned, inside the /24, big enough and overlap-free. It leaves a hole at ${SMALL_HOLES.map((h) => rangeLabel(h)).join(", ")} instead of a free range at the end — less convenient, not wrong.` },
  { id: "sdd-quiz-5", prompt: `What is the real block of "10.44.0.160/26"?`, options: [{ id: "160", label: "10.44.0.160/26 (.160–.223)" }, { id: "128", label: `${INC_B.real}/26 (${rangeLabel(INC_B.realRange)})` }, { id: "192", label: "10.44.0.192/26 (.192–.255)" }, { id: "none", label: "It has none — it is rejected" }], correctId: "128", explanation: "160 AND 192 = 128. A host configured this way computes .128/26 — so does every router." },
];

// ------------------------------------------------------------------ content

export function SubnettingDeepDiveContent() {
  const [A, B, C, T] = ["LAN-A", "LAN-B", "LAN-C", "TRANSIT"].map((id) => REF_REPORT.checks.find((c) => c.id === id)!);
  return (
    <div className="space-y-12">
      {/* ---------------------------------------------------------------- Foundation */}
      <GuideSection id="sdd-why" eyebrow="Foundation" title="Why subnetting exists" tone="violet">
        <p>
          You own <Mono>{P}</Mono> — {PSIZE} addresses. Three LANs and one router-to-router link need addresses. One flat /24 would put all of them in one broadcast domain and one network; separate subnets give each its own range, its own gateway and its own boundary — without wasting space or overlapping.
        </p>
        <PlanBar rows={REF} label="The finished design" />
      </GuideSection>

      <GuideSection id="sdd-prefix" eyebrow="Foundation" title="What the prefix means (a recap)" tone="cyan">
        <p>
          IPv4 Addressing &amp; Subnetting taught that the prefix length is the number of leading network bits, and that a host compares itself with any destination using its own mask. Here you use the same idea the other way round: you pick prefixes so that every network gets the room it needs.
        </p>
        <DiagramFrame caption="Each extra network bit halves the block. The lowest 1 in the mask's last octet gives the block size.">
          <BinaryMasksDiagram />
        </DiagramFrame>
        <p>CIDR (RFC 4632) reads the boundary only from the prefix length. Historical classful A/B/C rules play no part in modern design: 10.44.0.0/24 is a /24 because the prefix says so, not because it starts with 10.</p>
      </GuideSection>

      <GuideSection id="sdd-requirements" eyebrow="Foundation" title="Host requirements" tone="success">
        <FieldTable title="Requirements (each LAN count includes R1's interface)" columns={["Network", "Addresses needed", "Who is counted"]} rows={SEGMENTS.map((s) => [s.id, String(s.hosts), s.id === "TRANSIT" ? "R1 + R2 exactly" : `all devices on ${s.id}, R1 included`])} />
        <Callout tone="warning" title="Don't add the gateway twice">
          The counts already include R1&apos;s interface. Sizing LAN-C for 26 instead of 25 would still give /27 here, but the habit breaks real designs whose requirement sits exactly on a power-of-two edge.
        </Callout>
      </GuideSection>

      <GuideSection id="sdd-powers" eyebrow="Foundation" title="Powers of two" tone="violet">
        <p>A block with h host bits holds exactly 2^h addresses. Sizes therefore come only in powers of two: 4, 8, 16, 32, 64, 128, 256 … A requirement of 25 cannot get a 25-address block; it gets the next power of two that, after reservations, still fits.</p>
      </GuideSection>

      {/* ---------------------------------------------------------------- One subnet */}
      <GuideSection id="sdd-ladder" eyebrow="Designing one subnet" title="The capacity ladder" tone="cyan">
        <FieldTable title={`LAN-C: ${seg("LAN-C").hosts} addresses`} columns={["Prefix", "Host bits", "Total", "Usable (2^h − 2)", "Verdict"]} rows={C_LADDER.map((l) => [`/${l.prefix}`, String(l.hostBits), String(l.total), String(l.usable), l.minimum ? "smallest fit" : l.fits ? "fits, bigger" : "too small"])} />
        <p>Read it as a proof: one rung too small, the chosen rung, one rung bigger. A prefix is justified only when the next longer prefix would not fit.</p>
      </GuideSection>

      <GuideSection id="sdd-hostbits" eyebrow="Designing one subnet" title="Host bits → prefix and mask" tone="violet">
        <FieldTable title="Every requirement in this lesson" columns={["Network", "Need", "Host bits h", "Prefix 32 − h", "Mask"]} rows={SEGMENTS.map((s) => [s.id, String(s.hosts), String(32 - minP(s.hosts)), `/${minP(s.hosts)}`, maskOf(minP(s.hosts))])} />
      </GuideSection>

      <GuideSection id="sdd-usable" eyebrow="Designing one subnet" title="Total vs usable addresses" tone="warning">
        <p>
          In an <Strong>ordinary LAN subnet</Strong> two addresses are reserved: all host bits 0 names the network, all host bits 1 is the broadcast. Usable = 2^h − 2. That is why a /24 LAN has 254 usable addresses while the /24 itself contains 256.
        </p>
        <Callout tone="violet" title="Scope">
          2^h − 2 is the rule for ordinary LAN subnets of /30 and shorter. A /31 (RFC 3021, point-to-point) and a /32 (one address) are different — see “/31 and /32”.
        </Callout>
      </GuideSection>

      <GuideSection id="sdd-block" eyebrow="Designing one subnet" title="Block size" tone="cyan">
        <FieldTable title="Prefix → block" columns={["Prefix", "Mask", "Block", "Ordinary usable"]} rows={[25, 26, 27, 28, 29, 30].map((p) => [`/${p}`, maskOf(p), String(blockSize(p)), String(slUsable(p))])} />
      </GuideSection>

      <GuideSection id="sdd-boundary" eyebrow="Designing one subnet" title="Valid boundaries" tone="success">
        <p>
          A block may only start where its host bits are all 0 — on a multiple of its own size. For a /27 inside {P}: <Mono>.0 .32 .64 .96 .128 .160 .192 .224</Mono>. Every other address is a host inside one of those eight blocks.
        </p>
        <DiagramFrame caption={`${SL_CALC.address} under /${SL_CALC.prefix}: its host bits are not all 0.`}>
          <BinaryAddress ip={SL_CALC.address} prefix={SL_CALC.prefix} caption={`${SL_CALC.address}/${SL_CALC.prefix}`} />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-network" eyebrow="Designing one subnet" title="Network address" tone="violet">
        <p>
          Any address AND its mask gives the network it belongs to: <Mono>{SL_CALC.address} AND {CALC.mask} = {CALC.network}</Mono>. Subnet zero — the first block, like LAN-A&apos;s {A.real}/{A.prefix} — is a perfectly valid network; the old “don&apos;t use subnet zero” rule is obsolete.
        </p>
      </GuideSection>

      <GuideSection id="sdd-firstlast" eyebrow="Designing one subnet" title="First and last usable" tone="cyan">
        <p>
          First usable = network + 1 = <Mono>{CALC.first}</Mono>. Last usable = broadcast − 1 = <Mono>{CALC.last}</Mono>. R1 takes the first usable address of each LAN in this design (for example {numToIp(B.realRange.first + 1)} on LAN-B).
        </p>
      </GuideSection>

      <GuideSection id="sdd-broadcast" eyebrow="Designing one subnet" title="Broadcast" tone="warning">
        <p>
          All host bits 1: <Mono>{CALC.broadcast}</Mono> for {CALC.network}/{CALC.prefix}. In this plan the broadcasts are {[A, B, C, T].map((c) => `${c.id} ${dotOct(numToIp(c.realRange.last))}`).join(", ")} — only the whole /24 would end in .255.
        </p>
      </GuideSection>

      <GuideSection id="sdd-next" eyebrow="Designing one subnet" title="Next subnet" tone="success">
        <p>
          Next subnet = broadcast + 1 = <Mono>{CALC.next}</Mono>. That is where the next /{CALC.prefix} may start — and, because {lastOctet(CALC.next)} is a multiple of 32, also where any smaller block may start.
        </p>
        <FieldTable title={`${SL_CALC.address}/${SL_CALC.prefix} — the whole calculation`} columns={["Network", "First", "Last", "Broadcast", "Next"]} rows={[[`${CALC.network}/${CALC.prefix}`, CALC.first, CALC.last, CALC.broadcast, CALC.next]]} />
      </GuideSection>

      {/* ---------------------------------------------------------------- FLSM */}
      <GuideSection id="sdd-borrow" eyebrow="Equal-size subnetting" title="Borrowing bits" tone="violet">
        <p>Fixed-length subnetting (FLSM) lengthens the parent prefix by b bits for every subnet at once. Each borrowed bit doubles the number of subnets and halves their size.</p>
      </GuideSection>

      <GuideSection id="sdd-count" eyebrow="Equal-size subnetting" title="Subnet count" tone="cyan">
        <p>Borrowing b bits from a /24 gives 2^b subnets of 2^(8 − b) addresses each: 1 bit → 2 × 128, 2 bits → 4 × 64, 3 bits → 8 × 32.</p>
      </GuideSection>

      <GuideSection id="sdd-equal" eyebrow="Equal-size subnetting" title={`Equal splits of ${P}`} tone="success">
        <FieldTable title="FLSM options for this parent" columns={["Split", "Borrowed", "Subnets", "Usable each", "Fits all four?"]} rows={SPLITS.map((f) => [`/${f.prefix}`, `${f.borrowed} bit${f.borrowed === 1 ? "" : "s"}`, String(f.count), String(f.usable), f.satisfiesAll ? "yes" : !f.enoughSubnets ? "no — too few subnets" : `no — ${f.fits.filter((x) => !x.fits).map((x) => x.id).join(", ")} too small`])} />
      </GuideSection>

      <GuideSection id="sdd-flsm-fails" eyebrow="Equal-size subnetting" title="Why FLSM can't fit this design" tone="danger">
        <p>Four networks need at least four subnets (/26 or longer). LAN-A needs a /25. FLSM forces one size on everyone, so it would need four /25s — 512 addresses in a 256-address parent. The sizes differ too much for any single prefix.</p>
      </GuideSection>

      {/* ---------------------------------------------------------------- VLSM */}
      <GuideSection id="sdd-why-vlsm" eyebrow="VLSM" title="Why VLSM" tone="violet">
        <p>Variable-length subnet masking gives every network its own prefix. LAN-A gets a /25 and the transit link a /30 — inside the same parent, as long as every block is aligned and nothing overlaps.</p>
      </GuideSection>

      <GuideSection id="sdd-size-all" eyebrow="VLSM" title="Size every requirement" tone="cyan">
        <p>
          Smallest fitting prefixes: {SEGMENTS.map((s) => `${s.id} /${minP(s.hosts)} (${blockSize(minP(s.hosts))})`).join(", ")}. Total {SEGMENTS.reduce((n, s) => n + blockSize(minP(s.hosts)), 0)} of {PSIZE} addresses — add up the blocks, not the raw counts ({SEGMENTS.reduce((n, s) => n + s.hosts, 0)}).
        </p>
      </GuideSection>

      <GuideSection id="sdd-largest" eyebrow="VLSM" title="The largest-first method" tone="success">
        <FlowSteps
          steps={[
            { title: "Sort", body: "Largest requirement first.", tone: "cyan" },
            { title: "Place", body: "Start the first block at the parent's base.", tone: "violet" },
            { title: "Move on", body: "The next free address is the previous block's broadcast + 1.", tone: "success" },
            { title: "Repeat", body: "Place each smaller block there — it is already on a valid boundary.", tone: "warning" },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdd-convenient" eyebrow="VLSM" title="Why largest-first is convenient — and what it is not" tone="warning">
        <p>
          A block of 2^k addresses that starts on a multiple of 2^k also ends just before a multiple of 2^k — and therefore before a multiple of every smaller power of two. So after a larger block, the next free address is already aligned for anything smaller: no skipped gaps, no backtracking, one contiguous free range at the end.
        </p>
        <DiagramFrame caption="Largest-first: no holes, free space at the end.">
          <PlanBar rows={REF} label="Largest-first" />
        </DiagramFrame>
        <DiagramFrame caption={`Smallest-first: also valid (${SMALL_REPORT.allValid ? "every rule passes" : "fails"}), with a hole at ${SMALL_HOLES.map((h) => rangeLabel(h)).join(", ")}.`}>
          <PlanBar rows={SMALL_FIRST} label="Smallest-first" />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Largest-first", tone: "success", tag: "convenient", points: ["Next free address is always a boundary", `Free space: ${REF_REPORT.space.ranges.map((r) => rangeLabel(r)).join(", ")} (${REF_REPORT.space.free})`, "Easy to document and grow"] },
            { title: "Smallest-first", tone: "warning", tag: "valid", points: ["Must round up to each boundary", `Free space: ${SMALL_REPORT.space.ranges.map((r) => rangeLabel(r)).join(", ")} (${SMALL_REPORT.space.free})`, "Holes to track between blocks"] },
          ]}
        />
        <Callout tone="cyan" title="It does not create address space">
          Both orders leave {REF_REPORT.space.free} addresses free. Largest-first changes where the free space ends up, not how much there is.
        </Callout>
      </GuideSection>

      <GuideSection id="sdd-allocate" eyebrow="VLSM" title="Allocation walk-through" tone="cyan">
        <FieldTable title="Largest-first in this /24" columns={["Network", "Block", "Next free before", "Placed at", "Range"]} rows={[A, B, C, T].map((c, i, all) => [c.id, String(blockSize(c.prefix)), i === 0 ? dotOct(PARENT.network) : dotOct(numToIp(all[i - 1].realRange.last + 1)), `${dotOct(c.real)}/${c.prefix}`, rangeLabel(c.realRange)])} />
        <LabBridge label="Allocate it yourself">Place the four blocks in any order in the Subnet Design Studio and watch the validator and the address ruler.</LabBridge>
      </GuideSection>

      <GuideSection id="sdd-free" eyebrow="VLSM" title="Free space as ranges" tone="violet">
        <p>
          What is left — <Mono>{rangeLabel(REF_FREE)}</Mono>, {REF_FREE.last - REF_FREE.first + 1} addresses — is free ADDRESS SPACE, recorded as a range. It is not a subnet: 28 is not a power of two, and .228/27 would really be .224/27.
        </p>
      </GuideSection>

      <GuideSection id="sdd-free-blocks" eyebrow="VLSM" title="Aligned blocks in free space" tone="success">
        <DiagramFrame caption="Break a free range into aligned blocks only when you need to allocate from it.">
          <FreeSpaceDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-landd" eyebrow="VLSM" title="Fitting a new requirement: LAN-D" tone="cyan">
        <p>
          A new LAN-D needs {SL_LAN_D.hosts} addresses → /{minP(SL_LAN_D.hosts)} (16). 28 addresses are free, but the free range starts at {dotOct(numToIp(REF_FREE.first))}:
        </p>
        <FieldTable title="Candidates" columns={["Written", "Real block", "Verdict"]} rows={[[`${dotOct(D_BAD.written)}/${D_BAD.prefix}`, `${dotOct(D_BAD.real)}/${D_BAD.prefix}`, codes(D_BAD)], [`${dotOct(D_GOOD.written)}/${D_GOOD.prefix}`, `${dotOct(D_GOOD.real)}/${D_GOOD.prefix}`, codes(D_GOOD)]]} />
        <p>Free address count alone is not enough; the block needs an aligned start inside the free range.</p>
      </GuideSection>

      {/* ---------------------------------------------------------------- Validation */}
      <GuideSection id="sdd-overlap" eyebrow="Validation" title="Overlap" tone="danger">
        <p>Two blocks overlap when they share at least one address: A.first ≤ B.last and B.first ≤ A.last. Touching is fine — .128/26 ends at .191 and .192/27 starts at .192.</p>
      </GuideSection>

      <GuideSection id="sdd-diff-mask" eyebrow="Validation" title="Overlap across different masks" tone="warning">
        <p>
          Different masks do not protect you. <Mono>10.44.0.160/27</Mono> is aligned and big enough, yet it lies entirely inside LAN-B&apos;s <Mono>10.44.0.128/26</Mono>: <Strong>{codes(OVL)}</Strong>. This is the guided lesson&apos;s incident.
        </p>
      </GuideSection>

      <GuideSection id="sdd-misaligned" eyebrow="Validation" title="Misalignment and the real block" tone="danger">
        <p>
          A misaligned start is not rejected by hosts or routers — it is <Strong>normalised</Strong>: they compute address AND mask. So “10.44.0.200/27” is really {CALC.network}/27, and “10.44.0.160/26” is really {INC_B.real}/26 ({rangeLabel(INC_B.realRange)}). A plan must be judged on these real blocks, and a good tool shows both the written start and the real block instead of silently fixing it.
        </p>
        <DiagramFrame caption="10.44.0.160 under /26.">
          <BinaryAddress ip={INC_B.written} prefix={INC_B.prefix} caption="10.44.0.160/26" />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="sdd-contain" eyebrow="Validation" title="Containment" tone="violet">
        <p>
          Every block must lie inside the parent. <Mono>10.44.1.0/27</Mono> → <Strong>{codes(OUT_C)}</Strong>. A prefix shorter than the parent (a /23 here) can never fit inside it.
        </p>
      </GuideSection>

      <GuideSection id="sdd-small" eyebrow="Validation" title="Too small" tone="danger">
        <p>
          LAN-C at <Mono>10.44.0.192/28</Mono>: {SMALL_C.violations[0]?.text} → <Strong>{codes(SMALL_C)}</Strong>. Violations combine: LAN-C at <Mono>10.44.0.200/28</Mono> is <Strong>{codes(MULTI)}</Strong> at the same time.
        </p>
      </GuideSection>

      <GuideSection id="sdd-oversized" eyebrow="Validation" title="Oversized (an advisory)" tone="warning">
        <p>
          LAN-C at <Mono>10.44.0.192/26</Mono> is valid ({codes(BIG_C)}) but bigger than needed: {BIG_C.oversized} Oversizing is a design choice — sometimes deliberate growth headroom — so it is flagged, never failed.
        </p>
      </GuideSection>

      <GuideSection id="sdd-whole" eyebrow="Validation" title="Whole-plan validation" tone="success">
        <ChecklistCard tone="success" title="A plan is valid when" mark="✓" items={["every requirement is placed", "every block is aligned to its own size", "every block is inside the parent", "every block holds its requirement", "no two real blocks share an address"]} />
        <p>Overlap is a property of pairs, so a plan can fail even when every row looks fine on its own. Check the whole plan, not just the latest row.</p>
      </GuideSection>

      {/* ---------------------------------------------------------------- Special prefixes */}
      <GuideSection id="sdd-31-32" eyebrow="Special prefixes" title="/31 and /32" tone="violet">
        <DiagramFrame caption="RFC 3021 allows /31 where a link has exactly two ends.">
          <Slash31Diagram />
        </DiagramFrame>
        <p>
          <Strong>/31</Strong>: on a point-to-point link (RFC 3021) both addresses are usable — there is no conventional network/broadcast reservation on that subnet. It saves two addresses per link where both ends support it. This plan uses the conventional /30 for the transit link, and the Studio&apos;s allocator stays within /23–/30.
        </p>
        <DiagramFrame caption="Loopbacks and host routes.">
          <Slash32Diagram />
        </DiagramFrame>
        <p>
          <Strong>/32</Strong>: exactly one IPv4 address — common for loopbacks and host routes. It has no ordinary host range.
        </p>
        <Callout tone="warning" title="So never say “always 2^h − 2”">The minus-2 rule describes ordinary LAN subnets. It does not describe /31 or /32.</Callout>
      </GuideSection>

      {/* ---------------------------------------------------------------- Operations */}
      <GuideSection id="sdd-read" eyebrow="Operations" title="Reading a plan" tone="cyan">
        <FieldTable title={`The plan for ${P}`} columns={["Network", "Need", "Block", "Usable", "First – last", "Broadcast"]} rows={[A, B, C, T].map((c) => [c.id, String(c.hosts), `${c.real}/${c.prefix}`, String(slUsable(c.prefix)), `${numToIp(c.realRange.first + 1)} – ${numToIp(c.realRange.last - 1)}`, numToIp(c.realRange.last)])} />
        <p>Read each row as the one-subnet calculation, then read the rows together for overlap and free space.</p>
      </GuideSection>

      <GuideSection id="sdd-incident" eyebrow="Operations" title="The flawed-plan incident" tone="danger">
        <p>A colleague&apos;s spreadsheet lists:</p>
        <FieldTable title="As written" columns={["Network", "Written", "Documented range"]} rows={INC.map((r) => validateRow(INC, r.id)!).map((c) => [c.id, `${c.written}/${c.prefix}`, rangeLabel(c.writtenRange)])} />
        <DiagramFrame caption="The written ranges look contiguous…">
          <PlanBar rows={INC} label="As written" written />
        </DiagramFrame>
        <DiagramFrame caption="…but the real CIDR blocks overlap.">
          <PlanBar rows={INC} label="Real blocks" h={128} />
        </DiagramFrame>
        <p>
          {lastOctet(INC_B.written)} mod 64 = {lastOctet(INC_B.written) % 64}: not a /26 boundary. {lastOctet(INC_B.written)} AND 192 = {lastOctet(INC_B.real)}, so LAN-B is really {INC_B.real}/26 ({rangeLabel(INC_B.realRange)}) and contains all of LAN-C ({rangeLabel(INC_C.realRange)}). The symptom: a LAN-B host at {INC_SYM.host} computes {INC_SYM.decision.srcNet} for itself and for LAN-C&apos;s {INC_SYM.server} — <Strong>{INC_SYM.decision.local ? "LOCAL" : "REMOTE"}</Strong> — so it never uses its gateway {INC_SYM.gateway}.
        </p>
        <Callout tone="danger" title="Cause vs consequence">
          Root cause: an invalid boundary. Consequence: overlap. After a redesign (for example LAN-B {FIX.find((r) => r.id === "LAN-B")!.network}/26, LAN-C {FIX.find((r) => r.id === "LAN-C")!.network}/27) the same host check gives {FIX_SYM.host} → {FIX_SYM.server}: <Strong>{FIX_SYM.decision.local ? "LOCAL" : "REMOTE"}</Strong>. Other layouts pass too — LAN-B .192/26, LAN-C .128/27, Transit .160/30 is {ALT_OK ? "also valid" : "not valid"}.
        </Callout>
        <LabBridge label="Troubleshoot it in the Studio">Investigate the spreadsheet plan from evidence, test your hypothesis by applying the mask, then redesign until every rule passes.</LabBridge>
      </GuideSection>

      <GuideSection id="sdd-workflow" eyebrow="Operations" title="Troubleshooting workflow" tone="warning">
        <TroubleshootingFlow
          steps={[
            { question: "What is the symptom?", look: "Which hosts cannot reach which — and which still can." },
            { question: "What does the plan say?", look: "Read every row as written, without trusting it." },
            { question: "Is each start on its boundary?", look: "start mod block size = 0?" },
            { question: "Is each block big enough and inside the parent?", look: "2^h − 2 vs requirement (ordinary LAN); range inside the /24." },
            { question: "What are the real blocks?", look: "Address AND mask for every row." },
            { question: "Do any real blocks overlap?", look: "Pairwise matrix of real ranges." },
            { question: "Root cause or consequence?", look: "Which finding created the others?" },
            { question: "Redesign and verify", look: "All rules pass AND the failing behaviour is recomputed correct." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdd-signatures" eyebrow="Operations" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "overlap", title: "A host treats another LAN as on-link", tone: "danger", points: ["Its own AND says LOCAL for an address on another segment", "Cause: overlapping or misaligned blocks"] },
            { tag: "two-homes", title: "An address belongs to two segments", tone: "warning", points: ["The same address falls inside two planned ranges", "Cause: overlap"] },
            { tag: "refused", title: "Configuration refused on some routers", tone: "violet", points: ["The device rejects an interface address", "Many routers refuse overlapping interface subnets — don't rely on it"] },
            { tag: "full", title: "A segment runs out of addresses", tone: "warning", points: ["No free usable address left", "Cause: block too small"] },
            { tag: "nofit", title: "Free space looks big enough but nothing fits", tone: "cyan", points: ["The free count is sufficient", "Cause: no aligned start of the right size"] },
          ]}
        />
      </GuideSection>

      {/* ---------------------------------------------------------------- Master it */}
      <GuideSection id="sdd-myths" eyebrow="Master it" title="Common misconceptions" tone="violet">
        <Misconceptions
          items={[
            { myth: "“/24 always means 254 usable hosts.”", correction: "254 is the ordinary-LAN usable count. The /24 contains 256 addresses — and as a route or summary it simply covers all 256." },
            { myth: "“The broadcast is always .255.”", correction: `It is all host bits 1: here ${[A, B, C, T].map((c) => dotOct(numToIp(c.realRange.last))).join(", ")}.` },
            { myth: "“Any address can start a subnet.”", correction: "Only multiples of the block size. .200 is a host inside .192/27." },
            { myth: "“Different masks can't overlap.”", correction: ".160/27 lies inside .128/26." },
            { myth: "“VLSM starts can be anywhere.”", correction: "VLSM varies the size, never the alignment rule: .160/26 is really .128/26." },
            { myth: "“Smallest-first is invalid.”", correction: "It can produce a valid plan; it just leaves holes to track." },
            { myth: "“Largest-first creates more address space.”", correction: `Both orders leave ${REF_REPORT.space.free} addresses free. Largest-first keeps them contiguous.` },
            { myth: "“If every row looks valid, the plan is valid.”", correction: "Overlap is a property of pairs — check the whole plan." },
            { myth: "“28 free addresses form one /27.”", correction: "A /27 needs 32 aligned addresses. .228–.255 is .228/30 + .232/29 + .240/28." },
            { myth: "“2^h − 2 works for every prefix.”", correction: "Only for ordinary LAN subnets. /31 (RFC 3021) and /32 differ." },
            { myth: "“Routers will protect me from a bad plan.”", correction: "Some refuse overlapping interfaces on one device; nothing checks a spreadsheet or overlap across devices." },
            { myth: "“Unused gaps between VLSM blocks are lost.”", correction: "They stay allocatable as aligned blocks." },
            { myth: "“Subnet zero can't be used.”", correction: `An obsolete rule. LAN-A's ${A.real}/${A.prefix} is subnet zero and perfectly valid.` },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeCheck question={Q_PREFIX} />
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="sdd-challenge" eyebrow="Master it" title="Design challenge" tone="success">
        <p>
          Keep the four networks and add LAN-D ({SL_LAN_D.hosts} addresses). Where can it go without moving anything? Then try: LAN-C grows to 40 — what has to change? Do it in the Studio&apos;s free play and let the validator judge.
        </p>
        <details className="rounded-lg border border-white/10 p-3 text-sm text-pv-text-muted">
          <summary className="cursor-pointer text-xs font-semibold text-pv-cyan-soft">Show the reasoning</summary>
          <p className="mt-2">
            LAN-D → /28; the only aligned /28 in {rangeLabel(REF_FREE)} is {LAN_D_FIT.network}/{LAN_D_FIT.prefix}. LAN-C at 40 needs a /{minP(40)} ({blockSize(minP(40))}): the blocks then total {SEGMENTS.reduce((n, x) => n + blockSize(minP(x.id === "LAN-C" ? 40 : x.hosts)), 0)} — more than the parent&apos;s {PSIZE}. No arrangement fits; the design needs a bigger parent or a smaller requirement.
          </p>
        </details>
      </GuideSection>

      <GuideSection id="sdd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why does LAN-C get a /27 and not a /28 or a /26?", a: "2^4 − 2 = 14 < 25 ≤ 2^5 − 2 = 30. /28 is too small; /26 fits but is not the smallest." },
            { q: "Why can't 10.44.0.200 be a /27 network address?", a: "200 is not a multiple of 32: its host bits 01000 are not all 0. It is a host inside 10.44.0.192/27." },
            { q: "Why is largest-first convenient — and why isn't it required?", a: "After a 2^k block the next address is aligned for every smaller block, so there are no gaps. Other orders can still be valid; they leave holes." },
            { q: "Why is “10.44.0.160/26” a problem even though the spreadsheet looks tidy?", a: "160 AND 192 = 128: the real block is .128–.191, which contains LAN-C. Hosts compute the real block, not the documented range." },
          ]}
        />
      </GuideSection>

      <GuideSection id="sdd-practice" eyebrow="Master it" title="Practise in the Subnet Design Studio" tone="success">
        <p>Same {P}, your own copy: size a subnet from its requirement, test boundaries, calculate a whole subnet, try an equal split, allocate with VLSM, verify the plan, fit LAN-D, then troubleshoot the spreadsheet incident.</p>
        <LabBridge label="Open the Subnet Design Studio">Nothing you do there changes your lesson progress.</LabBridge>
      </GuideSection>

      {/* ---------------------------------------------------------------- Beyond */}
      <GuideSection id="sdd-beyond" eyebrow="Beyond this lesson" title="Not covered here — on purpose" tone="violet">
        <DiagramFrame caption="Carving every block from one parent keeps the plan summarisable.">
          <AggregationDiagram />
        </DiagramFrame>
        <FieldTable
          title="Where these topics belong"
          columns={["Topic", "Why it is out of scope here"]}
          rows={[
            ["Route summarisation / aggregation", `Because every block came from ${P}, a distant router needs one route instead of four. How it is advertised is a routing topic.`],
            ["IPv6 subnetting", "Same alignment ideas with /64 LANs and nibble boundaries — a different address family."],
            ["IPAM", "Tools that store, reserve and audit address plans at scale."],
            ["Growth policy", "Deliberately oversizing blocks or reserving neighbours for future growth."],
            ["Routing-table design", "Longest-prefix match across many summaries and more-specifics (Routing Fundamentals)."],
            ["NAT", "Translating private plans to public addresses."],
          ]}
        />
        <Glossary
          items={[
            { term: "CIDR", def: "Classless Inter-Domain Routing (RFC 4632): the prefix length alone defines the network." },
            { term: "FLSM", def: "Fixed-length subnet masking: every subnet the same size." },
            { term: "VLSM", def: "Variable-length subnet masking: each subnet its own prefix." },
            { term: "Real block", def: "Address AND mask — what hosts and routers actually use." },
            { term: "RFC 3021", def: "Allows /31 on point-to-point links." },
          ]}
        />
      </GuideSection>
    </div>
  );
}

