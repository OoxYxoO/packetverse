import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BASE_PROGRAM, NEXT_CSID_SUPPORTED_BEHAVIORS, REPLACE_CSID_SUPPORTED_BEHAVIORS } from "@/lib/sim-engine/scenarios/srv6Csid";
import { NEXT_CAPACITY, NEXT_CONTAINERS, NEXT_LAYOUT, REPLACE_CAPACITY, REPLACE_INDEX_BITS, REPLACE_LAYOUT } from "./guideModel";

export const SRV6C_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "cd-rfc", label: "RFC 9800 in one page" },
  { id: "cd-capacity", label: "Container capacity" },
  { id: "cd-flavors", label: "NEXT vs REPLACE mechanics" },
  { id: "cd-behaviors", label: "Which behaviors can carry a flavor" },
  { id: "cd-gib", label: "GIB and LIB allocation" },
  { id: "cd-control", label: "Advertising the structure" },
  { id: "cd-size", label: "Header size and MTU" },
  { id: "cd-integration", label: "SR Policy and TI-LFA" },
  { id: "cd-trouble", label: "Troubleshooting" },
  { id: "cd-verify", label: "Verification" },
  { id: "cd-glossary", label: "Glossary" },
  { id: "cd-mental", label: "Mental model" },
];

const behaviorName = (b: string) => (b === "END_DT4" ? "End.DT4" : b === "END_X" ? "End.X" : b === "END" ? "End" : b);

function CapacityDiagram() {
  const row = (y: number, name: string, bits: number, cap: number, color: string, block: boolean) => (
    <g>
      <text x={24} y={y + 20} fill={D.text} fontSize={11} fontWeight={700}>
        {name}
      </text>
      {block && (
        <>
          <rect x={150} y={y} width={120} height={30} rx={6} fill={D.cyan} fillOpacity={0.14} stroke={D.cyan} strokeOpacity={0.7} />
          <text x={210} y={y + 19} textAnchor="middle" fill={D.cyan} fontSize={9.5} fontWeight={700}>
            LBL {NEXT_LAYOUT.lblBits}
          </text>
        </>
      )}
      {Array.from({ length: cap }, (_, i) => {
        const x0 = block ? 274 : 150;
        const w = (614 - x0) / cap;
        return (
          <g key={i}>
            <rect x={x0 + i * w} y={y} width={w - 4} height={30} rx={6} fill={color} fillOpacity={0.14} stroke={color} strokeOpacity={0.7} />
            <text x={x0 + i * w + (w - 4) / 2} y={y + 19} textAnchor="middle" fill={color} fontSize={9.5} fontWeight={700} fontFamily="monospace">
              {bits}b
            </text>
          </g>
        );
      })}
    </g>
  );
  return (
    <DiagramSvg h={150} label={`Capacity: NEXT-CSID with ${NEXT_LAYOUT.lnflBits}-bit CSIDs fits ${NEXT_CAPACITY} per container; REPLACE-CSID with ${REPLACE_LAYOUT.lnflBits}-bit CSIDs fits ${REPLACE_CAPACITY}`}>
      {row(20, `NEXT (${NEXT_CAPACITY})`, NEXT_LAYOUT.lnflBits, NEXT_CAPACITY, D.violet, true)}
      {row(64, `REPLACE (${REPLACE_CAPACITY})`, REPLACE_LAYOUT.lnflBits, REPLACE_CAPACITY, D.warning, false)}
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        NEXT: ⌊(128 − LBL) / CSID⌋ after the block · REPLACE packed entry: ⌊128 / CSID⌋, no block
      </text>
    </DiagramSvg>
  );
}

function MechanicsDiagram() {
  return (
    <DiagramSvg h={200} label="NEXT-CSID shifts the remaining CSIDs left inside the destination address; REPLACE-CSID overwrites the active CSID with one read from a packed container at the position named by the Index">
      <text x={160} y={22} textAnchor="middle" fill={D.violet} fontSize={12} fontWeight={700}>
        NEXT-CSID
      </text>
      <DHeaderColumn x={160} y={34} w={230} rows={[{ text: "Block | A B C D E", color: D.violet, strong: true }, { text: "Block | B C D E 0", color: D.violet }]} caption="shift: drop A, pad at the end" />
      <text x={480} y={22} textAnchor="middle" fill={D.warning} fontSize={12} fontWeight={700}>
        REPLACE-CSID
      </text>
      <DHeaderColumn x={480} y={34} w={230} rows={[{ text: "Block | active | … | Index", color: D.warning, strong: true }, { text: "Block | packed[Index] | … | Index−1", color: D.warning }]} caption="replace: copy one packed CSID into the DA" />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        both decrement Hop Limit at every endpoint; both consume an SRH entry only when their container is exhausted
      </text>
    </DiagramSvg>
  );
}

function GibLibDiagram() {
  return (
    <DiagramSvg h={150} label="The CSID value space is split into a Global Identifiers Block, identifying nodes network-wide, and a Local Identifiers Block, whose values only have meaning at one node">
      <rect x={40} y={40} width={330} height={40} rx={8} fill={D.cyan} fillOpacity={0.14} stroke={D.cyan} strokeOpacity={0.8} />
      <text x={205} y={65} textAnchor="middle" fill={D.cyan} fontSize={11.5} fontWeight={700}>
        GIB — global node identifiers
      </text>
      <rect x={378} y={40} width={222} height={40} rx={8} fill={D.violet} fillOpacity={0.14} stroke={D.violet} strokeOpacity={0.8} />
      <text x={489} y={65} textAnchor="middle" fill={D.violet} fontSize={11.5} fontWeight={700}>
        LIB — per-node local
      </text>
      <text x={320} y={112} textAnchor="middle" fill={D.muted} fontSize={10}>
        e.g. a node&apos;s End from the GIB, its End.X / service SIDs from its own LIB
      </text>
    </DiagramSvg>
  );
}

function ControlDiagram() {
  return (
    <DiagramSvg h={170} label="Each node advertises its SID structure through the IGP or BGP-LS; the headend validates every structure before compressing a program">
      <DNode x={110} y={50} label="Node" sub="SID + structure" accent={D.ospf} w={150} />
      <DArrow x1={185} y1={50} x2={300} y2={50} color={D.ospf} label="IGP / BGP-LS" />
      <DNode x={380} y={50} label="Headend / PCE" sub="validate LBL·LNL·FL·AL" accent={D.warning} w={170} />
      <DArrow x1={380} y1={73} x2={380} y2={110} color={D.warning} />
      <text x={392} y={96} fill={D.warning} fontSize={10.5} fontWeight={700}>
        valid → compress
      </text>
      <DNode x={380} y={132} label="Compressed program" sub="containers + SRH" accent={D.violet} w={190} />
      <text x={110} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        unknown ≠ valid
      </text>
    </DiagramSvg>
  );
}

function SizeDiagram() {
  const n = BASE_PROGRAM.length;
  const c = NEXT_CONTAINERS.length;
  const bar = (y: number, label: string, bytes: number, color: string) => (
    <g>
      <text x={24} y={y + 17} fill={D.text} fontSize={11} fontWeight={700}>
        {label}
      </text>
      <rect x={200} y={y} width={(bytes / (n * 16)) * 380} height={26} rx={6} fill={color} fillOpacity={0.2} stroke={color} strokeOpacity={0.8} />
      <text x={206 + (bytes / (n * 16)) * 380} y={y + 17} fill={color} fontSize={10.5} fontWeight={700} fontFamily="monospace">
        {bytes} B
      </text>
    </g>
  );
  return (
    <DiagramSvg h={140} label={`Segment-value storage: ${n} uncompressed SIDs need ${n * 16} bytes; ${c} NEXT-CSID containers need ${c * 16} bytes`}>
      {bar(24, `${n} full SIDs`, n * 16, D.danger)}
      {bar(62, `${c} containers`, c * 16, D.success)}
      <text x={320} y={124} textAnchor="middle" fill={D.muted} fontSize={10}>
        segment values only — the 40-byte IPv6 header and 8-byte SRH fixed part are extra in both
      </text>
    </DiagramSvg>
  );
}

function IntegrationDiagram() {
  return (
    <DiagramSvg h={160} label="A TI-LFA repair outer can wrap a packet whose destination is a compressed container; the protected packet's compressed encoding is not changed by the repair">
      <DHeaderColumn
        x={320}
        y={24}
        w={360}
        rows={[
          { text: "TI-LFA repair outer (added at the PLR)", color: D.warning, tag: "REPAIR", strong: true },
          { text: "IPv6 · DA = compressed container · SRH", color: D.violet, tag: "PROGRAM" },
          { text: "payload", color: D.ip },
        ]}
      />
      <text x={320} y={124} textAnchor="middle" fill={D.muted} fontSize={10}>
        a policy chooses the program; compression only changes how it is encoded
      </text>
    </DiagramSvg>
  );
}

export function Srv6CsidDeepDiveContent() {
  return (
    <>
      <GuideSection id="cd-rfc" eyebrow="Background" title="RFC 9800 in one page" tone="cyan">
        <p>
          RFC 9800 defines how several SRv6 SIDs that share a Locator-Block are carried in fewer 128-bit fields. It adds endpoint <em>flavors</em> — NEXT-CSID and REPLACE-CSID — to existing behaviors rather than inventing new behaviors, so End, End.X or End.DT4 keep their meaning.
        </p>
      </GuideSection>

      <GuideSection id="cd-capacity" eyebrow="Encoding" title="Container capacity" tone="violet">
        <DiagramFrame caption="Capacity follows from the Locator-Block and CSID lengths.">
          <CapacityDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="cd-flavors" eyebrow="Encoding" title="NEXT vs REPLACE mechanics" tone="violet">
        <DiagramFrame caption="Two ways to reach the next CSID.">
          <MechanicsDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "NEXT-CSID", tone: "violet", tag: "shift", points: ["Short CSIDs, many per container", "No Index needed", "Argument space shrinks as it shifts"] },
            { title: "REPLACE-CSID", tone: "warning", tag: "replace", points: [`Longer CSIDs, ${REPLACE_CAPACITY} per packed entry`, `${REPLACE_INDEX_BITS}-bit Index in the DA's low bits`, "Physical position order differs from travel order"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="cd-behaviors" eyebrow="Rules" title="Which behaviors can carry a flavor" tone="bgp">
        <FieldTable
          title="In this lesson's model"
          accent="bgp"
          columns={["Flavor", "Behaviors"]}
          rows={[
            ["NEXT-CSID", NEXT_CSID_SUPPORTED_BEHAVIORS.map(behaviorName).join(", ")],
            ["REPLACE-CSID", REPLACE_CSID_SUPPORTED_BEHAVIORS.map(behaviorName).join(", ")],
          ]}
        />
        <p>The last segment of a program does not need a flavor at all — an ordinary service SID can end it.</p>
      </GuideSection>

      <GuideSection id="cd-gib" eyebrow="Allocation" title="GIB and LIB allocation" tone="cyan">
        <DiagramFrame caption="Global and local CSID values come from separate blocks.">
          <GibLibDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="cd-control" eyebrow="Control plane" title="Advertising the structure" tone="ospf">
        <DiagramFrame caption="A headend compresses only what it can validate.">
          <ControlDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="cd-size" eyebrow="Measurement" title="Header size and MTU" tone="cyan">
        <DiagramFrame caption="Computed from this lesson's program and containers.">
          <SizeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="cd-integration" eyebrow="Integration" title="SR Policy and TI-LFA" tone="warning">
        <DiagramFrame caption="Compression is orthogonal to path selection and protection.">
          <IntegrationDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="cd-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Ladder"
          mark="→"
          items={["Policy valid and every SID reachable?", "Every node's structure advertised and consistent?", "Every behavior compatible with the chosen flavor?", "Container boundaries where you expect them?", "Expanded program identical to the logical program?"]}
        />
      </GuideSection>

      <GuideSection id="cd-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard tone="success" title="Evidence" mark="✓" items={["The headend's compression plan and the reason for every uncompressed SID.", "Per-hop DA, Segments Left and Hop Limit on a real probe.", "An equivalence check of the expanded program."]} />
      </GuideSection>

      <GuideSection id="cd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Flavor", def: "A modifier on an endpoint behavior (NEXT-CSID, REPLACE-CSID, PSP, USP, USD)." },
            { term: "GIB / LIB", def: "Global and Local Identifiers Blocks of the CSID value space." },
            { term: "Packed container", def: "A REPLACE-CSID SRH entry holding several full-width CSIDs." },
            { term: "uSID", def: "Industry name associated with the NEXT-CSID style; not RFC 9800's normative term." },
          ]}
        />
      </GuideSection>

      <GuideSection id="cd-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="Recap" icon="✓">
          Compression is an encoding decision made after path selection: validate structures, choose a flavor the behaviors support, and treat any node you cannot validate as an ordinary SID.
        </Callout>
      </GuideSection>
    </>
  );
}
