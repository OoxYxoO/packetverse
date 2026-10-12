import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BASE_PROGRAM } from "@/lib/sim-engine/scenarios/srv6Csid";
import { BLOCK_TEXT, NEXT_CAPACITY, NEXT_CONTAINERS, NEXT_LAYOUT, NEXT_SRH_STORAGE, NEXT_WALK, REPLACE_CAPACITY, REPLACE_FINAL_DA, REPLACE_INDEX_BITS, REPLACE_LAYOUT, REPLACE_SLOTS, REPLACE_WALK, STRUCTURE } from "./guideModel";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { createUNet, uApply, uTicket, uTicketState, type UAction, type UR, type URtr, type UState, type UTicketId } from "@/lib/sim-engine/scenarios/ucNet";
import { ucSets, ucStaticApi } from "./uc-lab/ucCli";

export const SRV6C_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ul-mission", label: "What this lesson teaches" },
  { id: "ul-network", label: "The network of this lesson" },
  { id: "ul-ideas", label: "Three ideas you need" },
  { id: "ul-watch", label: "What you will watch" },
  { id: "ul-cost", label: "Why classic SRv6 gets heavy" },
  { id: "ul-structure", label: "Block, node, function" },
  { id: "ul-carriers", label: "Packing uSIDs into carriers" },
  { id: "ul-shift", label: "The shift at each node" },
  { id: "ul-walk", label: "One packet, R1 to R8" },
  { id: "ul-local", label: "Local uSIDs: uA and uDT4" },
  { id: "ul-replace", label: "REPLACE-CSID, briefly" },
  { id: "ul-working", label: "What working looks like" },
  { id: "ul-incident", label: "The uncompressible-node incident" },
  { id: "ul-repair", label: "Repair and proof" },
  { id: "ul-other", label: "Other ways it breaks" },
  { id: "ul-model", label: "Mental model" },
  { id: "ul-glossary", label: "Glossary" },
  { id: "ul-recap", label: "Recap" },
  { id: "ul-practice", label: "Practice it" },
];

/** Real IOS XR output and ping results on this page come from the SRv6 uSID Lab. */
const NL = String.fromCharCode(10);
const U0: UState = createUNet(0);
const run = (s: UState, ...a: UAction[]) => a.reduce((acc, x) => uApply(acc, x), s);
export const uSet = (text: string, dev: UR, f: (c: URtr) => void): UAction => ({ type: "set", text, changes: [{ dev, f }] });
export const uTicketRun = (id: UTicketId) => uTicket(id).repro.reduce((acc, a) => uApply(acc, a), uTicketState(id, 1));
const P100 = run(U0, { type: "ping", size: 100 });
const P1430 = run(U0, { type: "ping", size: 1430 });
const INC = uTicketRun("usidloc");
const INC_FIX = run(INC, uSet("fix", "R4", (c) => void (c.micro = true)), uSet("fix", "R1", (c) => void (c.lists!["PATH-A"].find((e) => e.idx === 30)!.sid = "fcbb:bb00:4::")), { type: "ping", size: 1430 });
const G = U0.view.green;
export function ucCli(s: UState, r: UR, command: string) {
  return runGuideCli(ucSets(ucStaticApi(s, r), r).cisco, command);
}
export function ucOnly(s: UState, r: UR, command: string, match: RegExp, keep = 0) {
  const x = ucCli(s, r, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** Lines from the first match of `from` up to (not including) the first later match of `stop`. */
export function ucBlock(s: UState, r: UR, command: string, from: RegExp, stop?: RegExp) {
  const x = ucCli(s, r, command);
  const lines = x.output.split(NL);
  const i = lines.findIndex((l) => from.test(l));
  if (i < 0) return x;
  let j = stop ? lines.findIndex((l, k) => k > i && stop.test(l)) : -1;
  if (j < 0) j = lines.length;
  return { ...x, output: lines.slice(i, j).join(NL) };
}
/** One ping, as the lab reports it. */
export function UcResult({ s, title, i }: { s: UState; title: string; i?: number }) {
  const t = s.tests[i ?? s.tests.length - 1];
  return (
    <Callout tone={t.walk.ok ? "success" : "danger"} title={title} icon={t.walk.ok ? "✓" : "!"}>
      CE1 → CE8, {t.size} bytes: {t.walk.ok ? `delivered via ${t.walk.path.join(" → ")}, ${t.walk.ms} ms` : t.walk.why} · {t.entries} entr{t.entries > 1 ? "ies" : "y"}, {t.overhead} bytes of overhead
    </Callout>
  );
}
/** The packet's destination address at each step, from the lab's walk. */
export function UcHops({ s }: { s: UState }) {
  const t = s.tests[s.tests.length - 1];
  return (
    <FieldTable
      title="The destination address, step by step (from the lab)"
      accent="ip"
      columns={["Where", "Destination address", "Active uSID", "SL", "Event"]}
      rows={t.walk.hops.filter((h) => h.da && h.kind !== "encap").map((h) => [h.to && h.at !== h.to ? `${h.at} → ${h.to}` : `at ${h.at}`, <Mono key="d">{h.da}</Mono>, h.active ?? "—", String(h.sl ?? "—"), h.kind === "shift" ? "shift" : h.kind === "next" ? "next carrier" : h.kind === "exec" ? "execute" : "route"])}
    />
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SRv6 uSID Lab" onPractice={openLab}>
      The network of this lesson on IOS XR with uSID locators: R1&apos;s carriers, the classic-vs-compressed comparison, the active uSID at every hop, an editable segment list, IOS XR consoles — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const FIRST_SHIFT = NEXT_WALK[0];
const BOUNDARY = NEXT_WALK.find((h) => h.boundary);
const behaviorLabel = (b?: string) => (b === "END_DT4" ? "End.DT4" : b === "END_X" ? "End.X" : "End");

function StructureDiagram() {
  const total = 128;
  const scale = 560 / total;
  const parts = [
    { name: "LBL", bits: STRUCTURE.lbl, color: D.cyan, sub: "Locator-Block" },
    { name: "LNL", bits: STRUCTURE.lnl, color: D.violet, sub: "Locator-Node" },
    { name: "FL", bits: STRUCTURE.fl, color: D.warning, sub: "Function" },
    { name: "AL", bits: STRUCTURE.al, color: D.faint, sub: "Argument" },
  ];
  let x = 40;
  return (
    <DiagramSvg h={170} label={`SID structure LBL ${STRUCTURE.lbl}, LNL ${STRUCTURE.lnl}, FL ${STRUCTURE.fl}, AL ${STRUCTURE.al} bits; AL must equal 128 minus LBL, LNL and FL`}>
      {parts.map((p) => {
        const w = p.bits * scale;
        const g = (
          <g key={p.name}>
            {w > 0 ? <rect x={x} y={40} width={w} height={40} rx={6} fill={p.color} fillOpacity={0.16} stroke={p.color} strokeOpacity={0.8} /> : <line x1={x} y1={34} x2={x} y2={86} stroke={p.color} strokeWidth={2} strokeDasharray="3 3" />}
            <text x={w > 0 ? x + w / 2 : x} y={w > 0 ? 65 : 28} textAnchor="middle" fill={p.color} fontSize={11.5} fontWeight={700} fontFamily="monospace">
              {p.name} {p.bits}
            </text>
            {w > 60 && (
              <text x={x + w / 2} y={100} textAnchor="middle" fill={D.muted} fontSize={9.5}>
                {p.sub}
              </text>
            )}
          </g>
        );
        x += w;
        return g;
      })}
      <text x={320} y={132} textAnchor="middle" fill={D.text} fontSize={11} fontFamily="monospace">
        AL = 128 − LBL − LNL − FL = {128 - STRUCTURE.lbl - STRUCTURE.lnl - STRUCTURE.fl}
      </text>
      <text x={320} y={154} textAnchor="middle" fill={D.muted} fontSize={10}>
        FL = 0 here, so each {STRUCTURE.lnl}-bit CSID is just the Locator-Node (the dashed marker)
      </text>
    </DiagramSvg>
  );
}

function ContainersDiagram() {
  const slotW = 64;
  const box = (y: number, label: string, text: string, owners: string[], color: string) => (
    <g>
      <text x={24} y={y + 22} fill={D.text} fontSize={11} fontWeight={700}>
        {label}
      </text>
      <rect x={130} y={y} width={120} height={34} rx={6} fill={D.cyan} fillOpacity={0.14} stroke={D.cyan} strokeOpacity={0.7} />
      <text x={190} y={y + 21} textAnchor="middle" fill={D.cyan} fontSize={9.5} fontWeight={700}>
        Locator-Block
      </text>
      {Array.from({ length: NEXT_CAPACITY }, (_, i) => (
        <g key={i}>
          <rect x={254 + i * slotW} y={y} width={slotW - 4} height={34} rx={6} fill={owners[i] ? color : D.faint} fillOpacity={owners[i] ? 0.16 : 0.08} stroke={owners[i] ? color : D.faint} strokeOpacity={0.7} />
          <text x={254 + i * slotW + (slotW - 4) / 2} y={y + 21} textAnchor="middle" fill={owners[i] ? color : D.faint} fontSize={10.5} fontWeight={700} fontFamily="monospace">
            {owners[i] ?? "pad"}
          </text>
        </g>
      ))}
      <text x={254 + NEXT_CAPACITY * slotW - 4} y={y + 50} textAnchor="end" fill={D.muted} fontSize={9.5} fontFamily="monospace">
        {text}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={200} label={`Container A holds ${NEXT_CONTAINERS[0]?.owners.join(", ")}; container B holds ${NEXT_CONTAINERS[1]?.owners.join(", ")} and padding`}>
      {NEXT_CONTAINERS.map((c, i) => (
        <g key={c.text}>{box(20 + i * 74, `Container ${String.fromCharCode(65 + i)}`, c.text, c.owners, i === 0 ? D.violet : D.warning)}</g>
      ))}
      <text x={320} y={186} textAnchor="middle" fill={D.muted} fontSize={10}>
        {NEXT_CAPACITY} CSIDs per container · one shared Locator-Block {BLOCK_TEXT} per 128 bits
      </text>
    </DiagramSvg>
  );
}

function ShiftDiagram() {
  if (!FIRST_SHIFT) return null;
  return (
    <DiagramSvg h={170} label={`At ${FIRST_SHIFT.router} the active CSID is consumed by a shift: the destination changes from ${FIRST_SHIFT.daBefore} to ${FIRST_SHIFT.daAfter}; Segments Left stays ${FIRST_SHIFT.slAfter}; Hop Limit ${FIRST_SHIFT.hlBefore} to ${FIRST_SHIFT.hlAfter}`}>
      <text x={24} y={40} fill={D.muted} fontSize={10.5}>
        DA in
      </text>
      <text x={90} y={40} fill={D.text} fontSize={12} fontWeight={700} fontFamily="monospace">
        {FIRST_SHIFT.daBefore}
      </text>
      <DArrow x1={200} y1={56} x2={200} y2={96} color={D.violet} />
      <text x={214} y={81} fill={D.violet} fontSize={10.5} fontWeight={700}>
        End + NEXT-CSID at {FIRST_SHIFT.router}
      </text>
      <text x={24} y={118} fill={D.muted} fontSize={10.5}>
        DA out
      </text>
      <text x={90} y={118} fill={D.text} fontSize={12} fontWeight={700} fontFamily="monospace">
        {FIRST_SHIFT.daAfter}
      </text>
      <text x={470} y={40} fill={D.success} fontSize={11} fontWeight={700}>
        SL {FIRST_SHIFT.slBefore} → {FIRST_SHIFT.slAfter} (unchanged)
      </text>
      <text x={470} y={118} fill={D.warning} fontSize={11} fontWeight={700}>
        HL {FIRST_SHIFT.hlBefore} → {FIRST_SHIFT.hlAfter}
      </text>
      <text x={320} y={156} textAnchor="middle" fill={D.muted} fontSize={10}>
        the Argument bits slide left behind the Locator-Block; no new 128-bit entry is read
      </text>
    </DiagramSvg>
  );
}

function WalkDiagram() {
  const colW = 88;
  return (
    <DiagramSvg h={170} label={`NEXT-CSID walk: ${NEXT_WALK.map((h) => `${h.router} Hop Limit ${h.hlBefore} to ${h.hlAfter}, Segments Left ${h.slBefore} to ${h.slAfter}`).join("; ")}`}>
      {NEXT_WALK.map((h, i) => {
        const x = 30 + i * colW;
        const color = h.boundary ? D.warning : D.violet;
        return (
          <g key={h.router}>
            <rect x={x} y={30} width={colW - 10} height={92} rx={9} fill={color} fillOpacity={h.boundary ? 0.16 : 0.08} stroke={color} strokeOpacity={0.8} />
            <text x={x + (colW - 10) / 2} y={52} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={700}>
              {h.router}
            </text>
            <text x={x + (colW - 10) / 2} y={76} textAnchor="middle" fill={D.muted} fontSize={10} fontFamily="monospace">
              HL {h.hlBefore}→{h.hlAfter}
            </text>
            <text x={x + (colW - 10) / 2} y={96} textAnchor="middle" fill={h.boundary ? D.warning : D.muted} fontSize={10} fontFamily="monospace">
              SL {h.slBefore}→{h.slAfter}
            </text>
            <text x={x + (colW - 10) / 2} y={114} textAnchor="middle" fill={color} fontSize={9} fontWeight={700}>
              {h.boundary ? "BOUNDARY" : "SHIFT"}
            </text>
          </g>
        );
      })}
      <text x={320} y={156} textAnchor="middle" fill={D.muted} fontSize={10}>
        every endpoint decrements Hop Limit · only the boundary consumes an SRH entry
      </text>
    </DiagramSvg>
  );
}

function FallbackDiagram() {
  const cell = (x: number, w: number, label: string, sub: string, color: string) => (
    <g>
      <rect x={x} y={40} width={w} height={44} rx={8} fill={color} fillOpacity={0.14} stroke={color} strokeOpacity={0.8} />
      <text x={x + w / 2} y={60} textAnchor="middle" fill={color} fontSize={11} fontWeight={700}>
        {label}
      </text>
      <text x={x + w / 2} y={76} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        {sub}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={150} label="If one node's advertised structure is invalid, its SID is carried as an ordinary 128-bit SID and the compressed run is split around it; the logical program does not change">
      {cell(24, 190, "compressed run", "valid structures", D.violet)}
      {cell(226, 188, "ordinary SID", "node with INVALID structure", D.danger)}
      {cell(426, 190, "compressed run", "valid structures", D.violet)}
      <text x={320} y={118} textAnchor="middle" fill={D.muted} fontSize={10}>
        more Segment List entries, same logical program — the node is still reachable
      </text>
    </DiagramSvg>
  );
}

function ReplaceSlotsDiagram() {
  const w = 132;
  return (
    <DiagramSvg h={190} label={`REPLACE-CSID packed container, physical positions: ${REPLACE_SLOTS.map((s) => `position ${s.position} ${s.owner ?? "padding"}`).join(", ")}`}>
      <text x={24} y={24} fill={D.muted} fontSize={10}>
        most significant bits →
      </text>
      {REPLACE_SLOTS.map((s, i) => {
        const x = 50 + i * (w + 8);
        const color = s.owner ? (s.behavior === "END_DT4" ? D.bgp : D.violet) : D.faint;
        return (
          <g key={s.position}>
            <rect x={x} y={36} width={w} height={64} rx={9} fill={color} fillOpacity={s.owner ? 0.15 : 0.06} stroke={color} strokeOpacity={0.8} />
            <text x={x + w / 2} y={56} textAnchor="middle" fill={D.muted} fontSize={10} fontWeight={700}>
              position {s.position}
            </text>
            <text x={x + w / 2} y={76} textAnchor="middle" fill={color} fontSize={12} fontWeight={700}>
              {s.owner ? `${s.owner} ${behaviorLabel(s.behavior)}` : "padding"}
            </text>
            <text x={x + w / 2} y={92} textAnchor="middle" fill={D.muted} fontSize={10} fontFamily="monospace">
              {s.text}
            </text>
          </g>
        );
      })}
      <text x={320} y={130} textAnchor="middle" fill={D.text} fontSize={11}>
        stored as-is: this is the PHYSICAL layout, not travel order
      </text>
      <text x={320} y={152} textAnchor="middle" fill={D.muted} fontSize={10}>
        processing visits positions {REPLACE_WALK.map((h) => h.position).join(" → ")} ({REPLACE_WALK.map((h) => REPLACE_SLOTS[h.position ?? 0]?.owner).join(" → ")})
      </text>
    </DiagramSvg>
  );
}

function IndexDiagram() {
  return (
    <DiagramSvg h={180} label={`REPLACE-CSID Index countdown: ${REPLACE_WALK.map((h) => `${h.router} Index ${h.indexBefore} to ${h.indexAfter}, packed position ${h.position}, Hop Limit ${h.hlBefore} to ${h.hlAfter}`).join("; ")}; final destination ${REPLACE_FINAL_DA}`}>
      {REPLACE_WALK.map((h, i) => {
        const x = 40 + i * 196;
        return (
          <g key={h.router}>
            <rect x={x} y={26} width={180} height={88} rx={10} fill={D.violet} fillOpacity={0.08} stroke={D.violet} strokeOpacity={0.75} />
            <text x={x + 90} y={48} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={700}>
              at {h.router}
            </text>
            <text x={x + 90} y={70} textAnchor="middle" fill={D.violet} fontSize={11} fontWeight={700} fontFamily="monospace">
              Index {h.indexBefore} → {h.indexAfter}
            </text>
            <text x={x + 90} y={88} textAnchor="middle" fill={D.muted} fontSize={10}>
              reads position {h.position}
            </text>
            <text x={x + 90} y={104} textAnchor="middle" fill={D.warning} fontSize={10} fontFamily="monospace">
              HL {h.hlBefore} → {h.hlAfter}
            </text>
          </g>
        );
      })}
      <text x={320} y={140} textAnchor="middle" fill={D.text} fontSize={11} fontFamily="monospace">
        final DA {REPLACE_FINAL_DA}
      </text>
      <text x={320} y={162} textAnchor="middle" fill={D.muted} fontSize={10}>
        the {REPLACE_INDEX_BITS}-bit Index lives in the low bits of the DA and counts DOWN from K−1
      </text>
    </DiagramSvg>
  );
}


export function Srv6CsidLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="ul-mission" eyebrow="This lesson" title="What this lesson teaches" tone="ip">
        <p>
          Every SRv6 lesson so far carried one 128-bit SID per instruction. That works, but a policy that names many waypoints, plus a VPN service SID, quickly costs a hundred bytes or more on every packet — and big packets stop fitting the MTU. This lesson answers: <b className="text-pv-text">how can SRv6 carry a long path with far less header?</b>
        </p>
        <p>The answer — compressed SIDs, RFC 9800, called <b className="text-pv-text">uSID</b> in the industry and in IOS XR — keeps every router, every behavior and the exact path. It changes only how the instructions are written into the packet. You will see what repeats in every SID, how many instructions fit in one 128-bit carrier, how each router finds and consumes its own, when the packet moves to the next carrier — and the guided lesson&apos;s incident, where one router can&apos;t take part.</p>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["explain what is compressed: the repeated block and padding, not the path", "read a uSID locator, a uN and a uA SID", "pack a SID list into carriers and count the bytes", "follow the active uSID router by router, including the carrier boundary", "explain why local uSIDs only work at their node", "find, fix and prove a compression fault"]} />
      </GuideSection>

      <GuideSection id="ul-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <p>
          Eight routers in a chain, R1 to R8, with two higher-metric shortcuts: R3–R5 and an express link R6–R8. CUST&apos;s site 1 sits behind R1 and site 8 behind R8. Policy GREEN on R1 sends CUST&apos;s traffic through R2, R3, R4, R5 and R6, then over the express link — a deliberately long, explicit path — and R8&apos;s VPN service SID finishes the program.
        </p>
        <Callout tone="cyan" title="The lesson and the lab" icon="i">
          The guided lesson uses the standards view of RFC 9800: Locator-Block <Mono>{BLOCK_TEXT}</Mono> with {NEXT_LAYOUT.lnflBits}-bit CSIDs, so {NEXT_CAPACITY} fit in a container; its program visits {BASE_PROGRAM.map((x) => x.owner).join(", ")}, and it compares NEXT-CSID with REPLACE-CSID ({REPLACE_LAYOUT.lnflBits}-bit CSIDs). Its incident is a router whose advertised SID structure is inconsistent. The lab runs IOS XR, which deploys NEXT-CSID as <b className="text-pv-text">uSID</b> in format <b className="text-pv-text">F3216</b>: a 32-bit block <Mono>fcbb:bb00::/32</Mono> and 16-bit uSIDs, so <b className="text-pv-text">6</b> fit in a carrier. Its incident is a router whose locator lost its micro-segment behavior — same consequence, an IOS XR cause. Outputs below come from the lab.
        </Callout>
      </GuideSection>

      <GuideSection id="ul-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "Block", tone: "violet", tag: "what repeats", points: ["the 32 bits every SID shares", "carried once per carrier"] },
            { title: "uSID", tone: "cyan", tag: "16 bits", points: ["a node (uN) or a local function (uA, uDT4)", "six fit after the block"] },
            { title: "Shift", tone: "success", tag: "at each node", points: ["execute the active uSID", "move the rest left"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ul-watch" eyebrow="This lesson" title="What you will watch" tone="cyan">
        <TroubleshootingFlow
          steps={[
            { question: "R1 builds GREEN's SID list", look: `${G.sids.length} SIDs: five from PATH-A, R8's uDT4 from BGP` },
            { question: "R1 packs them", look: `${G.entries.length} carriers: ${G.entries.map((e) => e.text).join(", ")}` },
            { question: "R2 … R5 execute and shift", look: "the active uSID moves one place at each node" },
            { question: "R6 runs out of carrier", look: "uN, then its local uA, then the next SRH entry" },
            { question: "R8 delivers", look: "uN, then its local uDT4 — decapsulate to CE8" },
          ]}
        />
      </GuideSection>

      <GuideSection id="ul-cost" eyebrow="The problem" title="Why classic SRv6 gets heavy" tone="danger">
        <p>
          Written classically, GREEN&apos;s {G.classicEntries} SIDs need {G.classicEntries} full IPv6 addresses: the first in the destination, the other {G.classicEntries - 1} in the SRH. 40 bytes of outer IPv6 + 8 bytes of SRH header + {G.classicEntries - 1} × 16 = <b className="text-pv-text">{G.classicOverhead} bytes</b> on every packet. With a 1500-byte core MTU, a 1430-byte customer packet would need {1430 + G.classicOverhead}.
        </p>
        <FieldTable
          title="GREEN, computed by the lab"
          accent="danger"
          columns={["", "Classic", "uSID (what R1 pushes)"]}
          rows={[
            ["128-bit entries", String(G.classicEntries), String(G.entries.length)],
            ["SRH bytes", String(G.classicSrhBytes), String(G.srhBytes)],
            ["Overhead (40 + SRH)", String(G.classicOverhead), String(G.overhead)],
            ["1430-byte packet on the wire", `${1430 + G.classicOverhead} ✗`, `${1430 + G.overhead} ✓`],
          ]}
        />
      </GuideSection>

      <GuideSection id="ul-structure" eyebrow="Structure" title="Block, node, function" tone="violet">
        <DiagramFrame caption="The guided lesson's view: Locator-Block, Locator-Node, Function, Argument (RFC 9800).">
          <StructureDiagram />
        </DiagramFrame>
        <p>
          Every SID is LOC:FUNCT:ARG. With compression the locator splits into a <b className="text-pv-text">block</b> shared by the whole domain and a short <b className="text-pv-text">node</b> part. In the lab every locator is <Mono>fcbb:bb00:N::/48</Mono> — block <Mono>fcbb:bb00</Mono>, node uSID <Mono>N</Mono>. IOS XR marks such a locator with flag <b className="text-pv-text">U</b> (micro-segment).
        </p>
        <CliPanel run={ucCli(U0, "R6", "show segment-routing srv6 locator")} caption="IOS XR · R6 — locator MAIN, a micro-segment (uSID) locator" />
        <CliPanel run={ucCli(U0, "R6", "show segment-routing srv6 sid")} caption="IOS XR · R6 — uN (one uSID) and three uAs (two uSIDs: 6 + a local value)" />
      </GuideSection>

      <GuideSection id="ul-carriers" eyebrow="Encoding" title="Packing uSIDs into carriers" tone="cyan">
        <DiagramFrame caption="The guided lesson's containers (48-bit block, 5 CSIDs each).">
          <ContainersDiagram />
        </DiagramFrame>
        <p>
          With <Mono>sid-format usid-f3216</Mono>, R1 takes GREEN&apos;s SIDs in order and writes their uSIDs one after another behind the block, six per 128-bit <b className="text-pv-text">carrier</b>, never splitting a SID. <Mono>2 3 4 5 6 e002</Mono> fill the first carrier exactly; R8&apos;s uDT4 (<Mono>8 e002</Mono>) starts the second. A carrier is itself a valid IPv6 address — it routes toward the owner of its first uSID.
        </p>
        <FieldTable title="The guided lesson's SRH storage (48-bit block, 5 CSIDs per container)" accent="cyan" columns={["Segment List", "Container", "Owners"]} rows={NEXT_SRH_STORAGE.map((e) => [`[${e.index}]`, <Mono key={e.index}>{e.text}</Mono>, e.owners.join(" · ")])} />
        <CliPanel run={ucOnly(U0, "R1", "show segment-routing traffic-eng policy", /SID format|SID\[|Packed/)} caption="IOS XR · R1 — five SIDs, one packed carrier (the service SID is added at forwarding)" />
        <CliPanel run={ucOnly(U0, "R1", "show cef vrf CUST 10.8.1.10", /via|SID-list|overhead/)} caption="IOS XR · R1 — what is pushed for site 8: two entries, 64 bytes" />
      </GuideSection>

      <GuideSection id="ul-shift" eyebrow="Forwarding" title="The shift at each node" tone="success">
        <DiagramFrame caption="The guided lesson's NEXT-CSID shift.">
          <ShiftDiagram />
        </DiagramFrame>
        <p>
          The <b className="text-pv-text">active uSID</b> is always the 16 bits right after the block (bits 32–47 of the destination). The router that owns it executes its behavior — uN means “I am a waypoint” — and then <b className="text-pv-text">shifts</b> the remaining uSIDs left by 16 bits, padding with zero. The destination now names the next owner, and ordinary IPv6 routing on the /48 locators takes it there. Segments Left doesn&apos;t move; the SRH is untouched while the carrier still holds uSIDs.
        </p>
      </GuideSection>

      <GuideSection id="ul-walk" eyebrow="Forwarding" title="One packet, R1 to R8" tone="ip">
        <DiagramFrame caption="The guided lesson's walk across two containers.">
          <WalkDiagram />
        </DiagramFrame>
        <UcHops s={P100} />
        <UcResult s={P100} title="The lab: CE1 → CE8, 100 bytes" />
        <p className="text-sm text-pv-text-muted">Segments Left changes exactly once — at R6, where the first carrier runs out and the second is copied in.{BOUNDARY ? ` In the guided lesson the boundary is at ${BOUNDARY.router}: Segments Left ${BOUNDARY.slBefore} → ${BOUNDARY.slAfter}.` : ""}</p>
      </GuideSection>

      <GuideSection id="ul-local" eyebrow="Forwarding" title="Local uSIDs: uA and uDT4" tone="violet">
        <p>
          Node uSIDs (2 … 8) are global: every router can route them on their locators. Values from <Mono>e000</Mono> to <Mono>efff</Mono> come from each node&apos;s <b className="text-pv-text">local ID block</b>: they are meaningful only at the node that has just executed its own uN. At R6, <Mono>e002</Mono> is R6&apos;s <b className="text-pv-text">uA</b> toward R8 (forward out that link); at R8, the same <Mono>e002</Mono> is R8&apos;s <b className="text-pv-text">uDT4</b> (decapsulate into VRF CUST). That is why a uA SID is written <Mono>fcbb:bb00:6:e002::</Mono>: two uSIDs, node first.
        </p>
        <CliPanel run={ucCli(U0, "R6", "show segment-routing srv6 sid fcbb:bb00:6:e002:: detail")} caption="IOS XR · R6 — the uA's structure and the two uSIDs it occupies" />
      </GuideSection>

      <GuideSection id="ul-replace" eyebrow="Briefly" title="REPLACE-CSID, briefly" tone="cyan">
        <DiagramFrame caption="The guided lesson's REPLACE-CSID packed container and its index.">
          <ReplaceSlotsDiagram />
        </DiagramFrame>
        <DiagramFrame caption="The guided lesson's REPLACE-CSID index: which packed CSID is next.">
          <IndexDiagram />
        </DiagramFrame>
        <p>RFC 9800 defines a second flavor. REPLACE-CSID keeps the full first SID in the destination and packs further 32-bit CSIDs into SRH entries that carry no block; an index in the argument says which one is next, and the destination&apos;s CSID is <i>replaced</i> rather than shifted. The guided lesson walks it ({REPLACE_CAPACITY} CSIDs per packed entry, {REPLACE_INDEX_BITS}-bit index). IOS XR deploys NEXT-CSID (uSID), so the lab does too.</p>
      </GuideSection>

      <GuideSection id="ul-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions (IOS XR)"
          accent="success"
          columns={["Question", "Command", "Healthy answer"]}
          rows={[
            ["Is every locator micro-segment?", <Mono key="1">show segment-routing srv6 locator</Mono>, "flag U on every router"],
            ["Does R1 pack?", <Mono key="2">show segment-routing traffic-eng policy</Mono>, "SID format usid-f3216, packed carriers"],
            ["What is pushed, how big?", <Mono key="3">show cef vrf CUST 10.8.1.10</Mono>, "2 entries, 64 bytes"],
            ["Do the local uSIDs exist?", <Mono key="4">show segment-routing srv6 sid</Mono>, "R6 uA e002 → R8, R8 uDT4 e002"],
            ["Does it work, big and small?", <Mono key="5">ping vrf CUST 10.8.1.10 size 1430</Mono>, "!!!!! — 11 ms over the express link"],
          ]}
        />
        <UcResult s={P1430} title="The lab: CE1 → CE8, 1430 bytes" />
      </GuideSection>

      <GuideSection id="ul-incident" eyebrow="Incident" title="The uncompressible-node incident" tone="danger">
        <DiagramFrame caption="The guided lesson's fallback: an uncompressible SID is carried in its own entry.">
          <FallbackDiagram />
        </DiagramFrame>
        <p>
          In the guided lesson, R4 advertises an inconsistent SID structure (AL 48 where 128 − 48 − 16 − 0 = 64): R4 is reachable, the policy is valid, packets are delivered — but R4 can&apos;t be compressed, so the encoding falls back to a mixed list. In the lab the same thing happens for an IOS XR reason: R4&apos;s locator lost <Mono>micro-segment behavior unode psp-usd</Mono>. R4 now allocates a classic End SID, <Mono>fcbb:bb00:4:1::</Mono>, the provisioning tool put it into PATH-A — and a classic SID can&apos;t share a carrier.
        </p>
        <UcResult s={INC} i={0} title="The lab: 100 bytes (the ticket)" />
        <UcResult s={INC} title="The lab: 1430 bytes (the ticket)" />
        <TroubleshootingFlow
          steps={[
            { question: "Is anything unreachable?", look: "No — small packets are delivered over the same path." },
            { question: "How many entries does R1 push?", look: "Three, not two: 80 bytes of overhead." },
            { question: "Which SID breaks the packing?", look: "fcbb:bb00:4:1:: — a classic SID in its own entry." },
            { question: "Why is it classic?", look: "R4's locator has no micro-segment behavior (no U flag)." },
          ]}
        />
        <CliPanel run={ucOnly(INC, "R1", "show segment-routing traffic-eng policy", /SID\[2\]|Packed/)} caption="IOS XR · R1 — three carriers for five SIDs" />
        <CliPanel run={ucCli(INC, "R4", "show segment-routing srv6 locator")} caption="IOS XR · R4 — no U flag: a classic locator" />
        <CliPanel run={ucOnly(INC, "R1", "show cef vrf CUST 10.8.1.10", /SID-list|overhead/)} caption="IOS XR · R1 — 80 bytes of overhead" />
      </GuideSection>

      <GuideSection id="ul-repair" eyebrow="Incident" title="Repair and proof" tone="success">
        <p>Two changes: make R4&apos;s locator a uSID locator again, and put R4&apos;s uN back into PATH-A.</p>
        <CliPanel run={{ prompt: "RP/0/RP0/CPU0:R4(config)#", command: "segment-routing srv6 locators locator MAIN", output: "RP/0/RP0/CPU0:R4(config-srv6-locator)#micro-segment behavior unode psp-usd\nRP/0/RP0/CPU0:R4(config-srv6-locator)#commit" }} caption="IOS XR · R4 — the locator" />
        <CliPanel run={{ prompt: "RP/0/RP0/CPU0:R1(config)#", command: "segment-routing traffic-eng segment-lists segment-list PATH-A srv6", output: "RP/0/RP0/CPU0:R1(config-sr-te-sl-srv6)#index 30 sid fcbb:bb00:4::\nRP/0/RP0/CPU0:R1(config-sr-te-sl-srv6)#commit" }} caption="IOS XR · R1 — the segment list" />
        <CliPanel run={ucOnly(INC_FIX, "R1", "show cef vrf CUST 10.8.1.10", /SID-list|overhead/)} caption="IOS XR · R1 — two entries, 64 bytes again" />
        <UcResult s={INC_FIX} title="The lab: a fresh 1430-byte ping" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["R4's locator carries the U flag", "R1 pushes two carriers, 64 bytes of overhead", "a fresh 1430-byte ping is delivered over the same path", "the lesson: compression changes the encoding — one uncompressible node costs a whole 128-bit entry"]} />
      </GuideSection>

      <GuideSection id="ul-other" eyebrow="Beyond this incident" title="Other ways it breaks" tone="warning">
        <FailureSignatures
          items={[
            { tag: "ORD", title: "uSIDs in the wrong order", tone: "warning", points: ["carrier order = execution order", "a longer path, no drop"] },
            { tag: "LIB", title: "Stale local uSID", tone: "danger", points: ["a uA re-allocated", "dropped at that node"] },
            { tag: "LOC", title: "Locator not advertised", tone: "danger", points: ["first uSID unreachable", "policy down, IGP path"] },
            { tag: "FMT", title: "Headend doesn't pack", tone: "violet", points: ["no sid-format", "one entry per SID"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the SRv6 uSID Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="ul-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of a delivery manifest. The classic way writes the full company address on a new line for every stop: “Acme Logistics, Depot 2”, “Acme Logistics, Depot 3”… The compressed way writes “Acme Logistics” once and then a row of depot numbers: 2 · 3 · 4 · 5 · 6. Each depot crosses off its own number and the driver heads for the next one on the line. Some entries are not depots but notes for the depot just visited — “at 6, take the express road” — that no other depot would understand. When the line is full, the driver turns to the next page. If one depot only accepts its full old-style address, it needs a line of its own, and the manifest gets longer.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          What does the customer see — size-dependent or not? Is GREEN up? Is every locator micro-segment and advertised? How does R1 pack the list, and how many bytes? Is the uSID order the path order? Do the local uSIDs still exist at their nodes?
        </Callout>
      </GuideSection>

      <GuideSection id="ul-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "CSID / uSID", def: "A compressed SID: 16 bits (here) that stand for a full SID within a shared block." },
            { term: "NEXT-CSID", def: "RFC 9800 flavor where each node shifts the next CSID into place — IOS XR's uSID." },
            { term: "Block", def: "The bits every SID of the domain shares (fcbb:bb00::/32)." },
            { term: "Carrier (container)", def: "One 128-bit entry: the block plus up to six uSIDs." },
            { term: "uN / uA / uDT4", def: "Node, adjacency and VPN-decapsulation behaviors with NEXT-CSID." },
            { term: "Local ID block", def: "Function values (e000–efff) meaningful only at their own node." },
            { term: "F3216", def: "IOS XR's uSID format: 32-bit block, 16-bit uSIDs." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ul-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["say what compression removes", "read uSID locators and SIDs", "pack a list and count its bytes", "follow the active uSID and the carrier boundary", "explain local uSIDs", "find, fix and prove a compression fault"]} />
      </GuideSection>

      <GuideSection id="ul-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers compressed SRv6 in full: RFC 9800, SID structure and capacity, NEXT-CSID and REPLACE-CSID mechanics, the global and local ID blocks, control-plane advertisement, header size, IOS XR configuration and verification, and every failure signature with real evidence. The lab lets you pack and break it yourself.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the SRv6 uSID / CSID presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
