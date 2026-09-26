import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BASE_PROGRAM } from "@/lib/sim-engine/scenarios/srv6Csid";
import { BLOCK_TEXT, NEXT_CAPACITY, NEXT_CONTAINERS, NEXT_LAYOUT, NEXT_SRH_STORAGE, NEXT_WALK, REPLACE_CAPACITY, REPLACE_FINAL_DA, REPLACE_INDEX_BITS, REPLACE_LAYOUT, REPLACE_SLOTS, REPLACE_WALK, STRUCTURE } from "./guideModel";

export const SRV6C_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lc-mission", label: "The mission" },
  { id: "lc-terms", label: "CSID, NEXT-CSID, REPLACE-CSID" },
  { id: "lc-structure", label: "SID structure" },
  { id: "lc-containers", label: "Building the containers" },
  { id: "lc-shift", label: "The NEXT-CSID shift" },
  { id: "lc-boundary", label: "Crossing a container boundary" },
  { id: "lc-endx", label: "End.X and the service SID" },
  { id: "lc-fault", label: "When compression is refused" },
  { id: "lc-replace", label: "REPLACE-CSID physical layout" },
  { id: "lc-index", label: "The Index countdown" },
  { id: "lc-metrics", label: "What compression saves" },
  { id: "lc-mistakes", label: "Common mistakes" },
  { id: "lc-glossary", label: "Glossary" },
  { id: "lc-recap", label: "Mental model" },
];

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
  const uncompressed = BASE_PROGRAM.length * 16;
  const compressed = NEXT_CONTAINERS.length * 16;
  return (
    <>
      <GuideSection id="lc-mission" eyebrow="Introduction" title="The mission: stop repeating the Locator-Block" tone="cyan">
        <p>
          A {BASE_PROGRAM.length}-segment SRv6 program stores {BASE_PROGRAM.length} full 128-bit SIDs, and every one repeats the same Locator-Block. Compressed SIDs pack only the part that differs per hop, while the logical program — which nodes, which behaviors, in which order — stays exactly the same.
        </p>
      </GuideSection>

      <GuideSection id="lc-terms" eyebrow="Terminology" title="CSID, NEXT-CSID, REPLACE-CSID" tone="violet">
        <CompareCards
          items={[
            { title: "NEXT-CSID", tone: "violet", tag: "RFC 9800 flavor", points: [`${NEXT_LAYOUT.lnflBits}-bit CSIDs in this lesson`, "Shifts the Argument left at each endpoint", "Often called uSID in industry material"] },
            { title: "REPLACE-CSID", tone: "warning", tag: "RFC 9800 flavor", points: [`${REPLACE_LAYOUT.lnflBits}-bit CSIDs in this lesson`, "Replaces the active CSID from a packed container", "Uses an Index in the DA's low bits"] },
          ]}
        />
        <p>RFC 9800 uses CSID, NEXT-CSID and REPLACE-CSID as its normative terms; &quot;uSID&quot; is industry and historical naming associated with the NEXT-CSID style.</p>
      </GuideSection>

      <GuideSection id="lc-structure" eyebrow="Foundations" title="SID structure" tone="violet">
        <DiagramFrame caption="Compression is only safe when every node's advertised structure is known and consistent.">
          <StructureDiagram />
        </DiagramFrame>
        <FieldTable
          title="Validation outcomes"
          accent="violet"
          columns={["Advertised structure", "Result", "Compressible?"]}
          rows={[
            ["Consistent (AL matches the formula)", "VALID", "Yes"],
            ["Nothing advertised", "UNKNOWN", "No — never inferred"],
            ["Inconsistent (AL does not match)", "INVALID", "No"],
          ]}
        />
      </GuideSection>

      <GuideSection id="lc-containers" eyebrow="Encoding" title="Building the containers" tone="ip">
        <DiagramFrame caption="Values produced by the lesson's own compression function.">
          <ContainersDiagram />
        </DiagramFrame>
        <FieldTable
          title="SRH storage (reverse order)"
          accent="ip"
          columns={["Segment List", "Container", "CSIDs"]}
          rows={NEXT_SRH_STORAGE.map((e) => [`[${e.index}]`, <Mono key={e.index}>{e.text}</Mono>, e.owners.join(" · ")])}
        />
      </GuideSection>

      <GuideSection id="lc-shift" eyebrow="Data plane" title="The NEXT-CSID shift" tone="violet">
        <DiagramFrame caption="Shown for the first endpoint; every intra-container endpoint does the same.">
          <ShiftDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lc-boundary" eyebrow="Data plane" title="Crossing a container boundary" tone="warning">
        <DiagramFrame caption="The full walk, from the real advance function.">
          <WalkDiagram />
        </DiagramFrame>
        {BOUNDARY && (
          <p>
            At {BOUNDARY.router} the last CSID of the first container is consumed. That endpoint behaves like an ordinary End: Segments Left drops {BOUNDARY.slBefore} → {BOUNDARY.slAfter}, the next container is copied into the DA, and Hop Limit still decrements ({BOUNDARY.hlBefore} → {BOUNDARY.hlAfter}).
          </p>
        )}
      </GuideSection>

      <GuideSection id="lc-endx" eyebrow="Variants" title="End.X and the service SID" tone="bgp">
        <p>
          The same flavor works on End.X: the shift happens, then the packet is forced over the bound adjacency instead of following the IGP. A program may also end on an ordinary service SID such as End.DT4 — the final entry does not need a compression flavor.
        </p>
      </GuideSection>

      <GuideSection id="lc-fault" eyebrow="Troubleshooting" title="When compression is refused" tone="danger">
        <DiagramFrame caption="Refusing to compress is a safety outcome, not a reachability failure.">
          <FallbackDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="danger"
          title="How to reason about it (no spoilers)"
          mark="→"
          items={["Confirm the policy is valid and every SID is reachable.", "Compare each node's advertised structure with the formula.", "Look for where the compressed run is split.", "After a fix, resend and verify the expanded program equals the original."]}
        />
      </GuideSection>

      <GuideSection id="lc-replace" eyebrow="Second flavor" title="REPLACE-CSID physical layout" tone="warning">
        <DiagramFrame caption={`K = ${REPLACE_CAPACITY} CSIDs of ${REPLACE_LAYOUT.lnflBits} bits per packed container.`}>
          <ReplaceSlotsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lc-index" eyebrow="Second flavor" title="The Index countdown" tone="warning">
        <DiagramFrame caption="Each advance reads the position named by the new Index.">
          <IndexDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lc-metrics" eyebrow="Measurement" title="What compression saves" tone="cyan">
        <FieldTable
          title="Segment-value storage for this program"
          accent="cyan"
          columns={["Encoding", "Entries", "Bytes"]}
          rows={[
            ["Uncompressed SIDs", String(BASE_PROGRAM.length), String(uncompressed)],
            ["NEXT-CSID containers", String(NEXT_CONTAINERS.length), String(compressed)],
          ]}
        />
        <p>This counts segment values only — not the IPv6 header, the SRH fixed fields or the payload.</p>
      </GuideSection>

      <GuideSection id="lc-mistakes" eyebrow="Troubleshooting" title="Common mistakes" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Avoid these"
          mark="!"
          items={["Expecting Segments Left to change on every shift.", "Forgetting that the boundary endpoint also decrements Hop Limit.", "Drawing a REPLACE container in travel order and calling it the physical layout.", "Treating an INVALID or UNKNOWN structure as a reachability problem.", "Assuming compression changes the logical program."]}
        />
      </GuideSection>

      <GuideSection id="lc-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "CSID", def: "Compressed SID — the per-node part of a SID carried inside a container." },
            { term: "Container", def: "One 128-bit value holding a Locator-Block followed by several CSIDs." },
            { term: "LBL / LNL / FL / AL", def: "Locator-Block, Locator-Node, Function and Argument lengths, in bits." },
            { term: "Shift", def: "NEXT-CSID advance inside a container: Argument slides left, SL unchanged." },
            { term: "Index", def: "REPLACE-CSID counter in the DA's low bits naming the next packed position." },
            { term: "Padding", def: "Unused CSID slots, filled with zeros." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lc-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          Validate every structure, pack only what differs per hop, advance inside a container without touching Segments Left, pay one End-style step at each boundary — and always prove the expanded program is unchanged.
        </Callout>
      </GuideSection>
    </>
  );
}
