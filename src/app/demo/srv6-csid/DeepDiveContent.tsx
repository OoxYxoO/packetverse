import { Callout, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { BASE_PROGRAM, NEXT_CSID_SUPPORTED_BEHAVIORS, REPLACE_CSID_SUPPORTED_BEHAVIORS } from "@/lib/sim-engine/scenarios/srv6Csid";
import { NEXT_CAPACITY, NEXT_CONTAINERS, NEXT_LAYOUT, REPLACE_CAPACITY, REPLACE_INDEX_BITS, REPLACE_LAYOUT } from "./guideModel";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { createUNet, uApply, type UState } from "@/lib/sim-engine/scenarios/ucNet";
import { UcResult, ucBlock, ucCli, ucOnly, uSet, uTicketRun } from "./LessonGuideContent";

const G2 = { foundation: "Foundation", encoding: "Encoding", forwarding: "Forwarding", design: "Design", ops: "Operations", trouble: "Troubleshooting", master: "Master it" };
export const SRV6C_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ud-why", label: "Why compression exists", group: G2.foundation },
  { id: "ud-terms", label: "uSID, CSID, NEXT and REPLACE", group: G2.foundation },
  { id: "ud-structure", label: "SID structure: LBL, LNL, FL, AL", group: G2.encoding },
  { id: "ud-capacity", label: "Carrier capacity", group: G2.encoding },
  { id: "ud-packing", label: "How the headend packs a list", group: G2.encoding },
  { id: "ud-mixed", label: "Mixed lists: when a SID can't be packed", group: G2.encoding },
  { id: "ud-next", label: "NEXT-CSID processing", group: G2.forwarding },
  { id: "ud-boundary", label: "The carrier boundary", group: G2.forwarding },
  { id: "ud-behaviors", label: "Which behaviors compress", group: G2.forwarding },
  { id: "ud-replace", label: "REPLACE-CSID processing", group: G2.forwarding },
  { id: "ud-giblib", label: "Global and local ID blocks", group: G2.design },
  { id: "ud-size", label: "Header size and MTU", group: G2.design },
  { id: "ud-control", label: "Control plane: advertising structure", group: G2.design },
  { id: "ud-integration", label: "SR policy and TI-LFA with uSIDs", group: G2.design },
  { id: "ud-config", label: "Configuring it on IOS XR", group: G2.ops },
  { id: "ud-verify", label: "How to verify", group: G2.ops },
  { id: "ud-signatures", label: "Failure signatures", group: G2.trouble },
  { id: "ud-ladder", label: "The troubleshooting ladder", group: G2.trouble },
  { id: "ud-tickets", label: "Five faults, evidence to proof", group: G2.trouble },
  { id: "ud-myths", label: "Common misconceptions", group: G2.master },
  { id: "ud-quiz", label: "Knowledge check", group: G2.master },
  { id: "ud-explain", label: "Can you explain it?", group: G2.master },
  { id: "ud-glossary", label: "Glossary", group: G2.master },
  { id: "ud-mental", label: "Mental model", group: G2.master },
  { id: "ud-practice", label: "Practice in the SRv6 uSID Lab", group: G2.master },
];

// Real IOS XR output and ping results: the SRv6 uSID Lab's command set and model.
const U0: UState = createUNet(0);
const T = { usidloc: uTicketRun("usidloc"), order: uTicketRun("order"), stalelib: uTicketRun("stalelib"), r2loc: uTicketRun("r2loc"), format: uTicketRun("format") };
const BOTH = [uSet("both shortcuts", "R1", (c) => void (c.lists!["PATH-A"] = [{ idx: 10, sid: "fcbb:bb00:3:e002::" }, { idx: 20, sid: "fcbb:bb00:6:e002::" }])), { type: "ping", size: 1430 } as const].reduce((acc, a) => uApply(acc, a), U0);
const G = U0.view.green;

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SRv6 uSID Lab" onPractice={openLab}>
      uSID locators on IOS XR, R1&apos;s carriers and byte counts, the active uSID at every hop, an editable segment list, five tickets — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

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


const QUIZ: KnowledgeQuestion[] = [
  { id: "q-what", prompt: "What does uSID compression remove from the packet?", options: [{ id: "a", label: "The block and padding repeated in every 128-bit SID" }, { id: "b", label: "Some routers from the path" }, { id: "c", label: "The outer IPv6 header" }], correctId: "a", explanation: "The program is unchanged; only its encoding shrinks." },
  { id: "q-cap", prompt: "F3216: how many uSIDs fit in one 128-bit carrier?", options: [{ id: "a", label: "6 — (128 − 32) / 16" }, { id: "b", label: "8" }, { id: "c", label: "5" }], correctId: "a", explanation: "The block takes 32 bits; 96 bits remain for 16-bit uSIDs." },
  { id: "q-sl", prompt: "R3 executes its uN and shifts. What happens to Segments Left?", options: [{ id: "a", label: "Nothing — it changes only when a carrier runs out" }, { id: "b", label: "It decrements" }, { id: "c", label: "It increments" }], correctId: "a", explanation: "Shifts happen inside the destination address." },
  { id: "q-local", prompt: "Why can't R5 route a packet whose active uSID is e002?", options: [{ id: "a", label: "e002 is a local ID; it has meaning only at the node that just executed its uN" }, { id: "b", label: "e002 is invalid hexadecimal" }, { id: "c", label: "R5 has no SRH" }], correctId: "a", explanation: "Only global (node) uSIDs are routed on locators." },
  { id: "q-classic", prompt: "A classic SID sits in the middle of a uSID list. What does the headend do?", options: [{ id: "a", label: "Closes the current carrier and gives the classic SID its own entry" }, { id: "b", label: "Drops the policy" }, { id: "c", label: "Compresses it anyway" }], correctId: "a", explanation: "Mixed lists are valid; they just cost more entries." },
  { id: "q-order", prompt: "Two uSIDs are swapped in the list. Typical symptom?", options: [{ id: "a", label: "A longer path, no drop" }, { id: "b", label: "Packets dropped at R1" }, { id: "c", label: "A smaller header" }], correctId: "a", explanation: "Carrier order is execution order." },
];

export function Srv6CsidDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="ud-why" eyebrow="Foundation" title="Why compression exists" tone="danger">
        <p>An SRv6 segment list costs 16 bytes per SID, plus an 8-byte SRH header once there is more than one. Long explicit paths, TI-LFA repairs stacked on policies, and service SIDs at the end can easily add 100+ bytes per packet: more bandwidth on every link, MTU pressure at the edge, and on some hardware a limit on how many SIDs can be pushed at all. Yet most of those bytes are the same: the domain&apos;s block, repeated in every SID, and padding behind a short node identifier. Compression (RFC 9800) writes the block once.</p>
        <FieldTable
          title="GREEN in the lab, computed from what R1 pushes"
          accent="danger"
          columns={["Encoding", "Entries", "Overhead", "Payload share of a 100-byte packet"]}
          rows={[
            ["Classic", String(G.classicEntries), `${G.classicOverhead} B`, `${Math.round((100 / (100 + G.classicOverhead)) * 100)} %`],
            ["uSID", String(G.entries.length), `${G.overhead} B`, `${Math.round((100 / (100 + G.overhead)) * 100)} %`],
          ]}
        />
      </GuideSection>

      <GuideSection id="ud-terms" eyebrow="Foundation" title="uSID, CSID, NEXT and REPLACE" tone="violet">
        <CompareCards
          items={[
            { title: "CSID (RFC 9800)", tone: "violet", tag: "standard", points: ["compressed SID: a short identifier inside a shared block", "two flavors: NEXT-CSID and REPLACE-CSID"] },
            { title: "uSID", tone: "cyan", tag: "industry / IOS XR", points: ["the NEXT-CSID flavor as deployed", "behaviors uN, uA, uDT…, format F3216"] },
            { title: "Classic SRv6", tone: "warning", tag: "RFC 8986", points: ["one 128-bit SID per instruction", "still fully interoperable — a compressed domain can carry classic SIDs"] },
          ]}
        />
        <p>The guided lesson keeps to the RFC&apos;s names and compares both flavors; the lab uses IOS XR&apos;s names for NEXT-CSID. They describe the same mechanism.</p>
      </GuideSection>

      <GuideSection id="ud-structure" eyebrow="Encoding" title="SID structure: LBL, LNL, FL, AL" tone="violet">
        <p>Every SID can be described by four lengths: Locator-Block (LBL), Locator-Node (LNL), Function (FL) and Argument (AL), with LBL + LNL + FL + AL = 128. Compression needs them: the headend must know which bits are the shared block and how long each compressed identifier is. IOS XR F3216 uses LBL 32 and 16-bit uSIDs — a uN is LNL 16, FL 0, AL 80; a uA or uDT4 adds a 16-bit function from the local ID block.</p>
        <CliPanel run={ucOnly(U0, "R6", "show segment-routing srv6 sid fcbb:bb00:6:: detail", /fcbb:bb00:6::|SID structure|uSID/)} caption="IOS XR · R6 — a uN: LBL 32, LNL 16, FL 0, AL 80" />
        <Callout tone="cyan" title="The guided lesson's structure check" icon="i">
          The guided lesson uses LBL {NEXT_LAYOUT.lblBits} and {NEXT_LAYOUT.lnflBits}-bit CSIDs and validates every advertised structure (LBL ≠ 0, LNL + FL ≠ 0, AL = 128 − LBL − LNL − FL). An inconsistent structure makes the SID “unknown”: never compressed, carried as an ordinary SID.
        </Callout>
      </GuideSection>

      <GuideSection id="ud-capacity" eyebrow="Encoding" title="Carrier capacity" tone="cyan">
        <DiagramFrame caption="How many compressed identifiers fit after the block.">
          <CapacityDiagram />
        </DiagramFrame>
        <p>Capacity is (128 − LBL) / CSID length: (128 − 32) / 16 = <b className="text-pv-text">6</b> for F3216; the guided lesson&apos;s 48-bit block gives {NEXT_CAPACITY}. RFC 9800 requires NEXT-CSID implementations to support a 32-bit block with 16-bit CSIDs — exactly F3216.</p>
      </GuideSection>

      <GuideSection id="ud-packing" eyebrow="Encoding" title="How the headend packs a list" tone="mpls">
        <p>The headend walks the SID list in order. A uSID-format SID contributes its uSIDs (one for a uN, two for a uA or uDT4); they are appended to the current carrier until the next SID would not fit — a SID is never split — and then a new carrier starts. Carriers go into the packet like ordinary SIDs: the first in the destination address, the rest in the SRH (reduced encapsulation).</p>
        <FieldTable
          title="GREEN, packed by the lab"
          accent="mpls"
          columns={["Entry", "Value", "uSIDs", "From SIDs"]}
          rows={G.entries.map((e, i) => [i === 0 ? "DA" : `SRH`, <Mono key="v">{e.text}</Mono>, e.usids.map((u) => u.toString(16)).join(" "), e.sids.join(", ")])}
        />
        <CliPanel run={ucOnly(BOTH, "R1", "show cef vrf CUST 10.8.1.10", /SID-list|overhead/)} caption="IOS XR · R1 — PATH-A with both shortcuts: everything in a single carrier, no SRH" />
        <UcResult s={BOTH} title="The lab: both shortcuts, 1430 bytes, one carrier" />
      </GuideSection>

      <GuideSection id="ud-mixed" eyebrow="Encoding" title="Mixed lists: when a SID can't be packed" tone="warning">
        <p>A SID that is not in uSID format — a classic SID, a SID from another block, or (in the guided lesson) one with an unknown or invalid structure — closes the current carrier and takes a whole 128-bit entry of its own; packing resumes after it. The list stays valid and the path is unchanged: only the overhead grows. That is exactly the guided incident.</p>
        <CliPanel run={ucOnly(T.usidloc, "R1", "show segment-routing traffic-eng policy", /SID\[|Packed/)} caption="IOS XR · R1 — R4's classic SID splits the packing: three entries" />
      </GuideSection>

      <GuideSection id="ud-next" eyebrow="Forwarding" title="NEXT-CSID processing" tone="success">
        <DiagramFrame caption="Match, shift, route — or move to the next entry.">
          <MechanicsDiagram />
        </DiagramFrame>
        <FieldTable
          title="What a router does with the destination address"
          accent="success"
          columns={["Case", "Action"]}
          rows={[
            ["Active uSID is its own uN / local uA / local uDT", "execute the behavior"],
            ["… and more uSIDs follow in the carrier", "shift them left 16 bits, pad with zero; Segments Left unchanged"],
            ["… and the carrier is exhausted, SL > 0", "copy the next SRH entry into the DA; SL − 1"],
            ["… uA", "forward out its adjacency"],
            ["… uDT4 (last)", "decapsulate, look up in the VRF"],
            ["Active uSID is another node's", "route the DA on that node's /48 locator"],
            ["Active uSID is a local ID that isn't ours", "no route — drop"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ud-boundary" eyebrow="Forwarding" title="The carrier boundary" tone="warning">
        <p>The boundary is the only place the SRH changes. In the lab it falls at R6: after its uN and its local uA, nothing is left in the first carrier, so R6 copies the second carrier into the destination (Segments Left 1 → 0) and forwards out of the express link. The guided lesson&apos;s containers are {NEXT_CONTAINERS.map((c) => c.owners.join("·")).join(" | ")} — its boundary falls one node earlier because a 48-bit block leaves room for five.</p>
        <CliPanel run={ucBlock(U0, "R1", "show cef vrf CUST 10.8.1.10", /SID-list/)} caption="IOS XR · R1 — the two carriers R6 moves between" />
      </GuideSection>

      <GuideSection id="ud-behaviors" eyebrow="Forwarding" title="Which behaviors compress" tone="violet">
        <FieldTable
          title="Behavior support (guided lesson's RFC model)"
          accent="violet"
          columns={["Flavor", "Behaviors", "Note"]}
          rows={[
            ["NEXT-CSID", NEXT_CSID_SUPPORTED_BEHAVIORS.map(behaviorName).join(", "), "service behaviors have no NEXT-CSID flavor in RFC 9800"],
            ["REPLACE-CSID", REPLACE_CSID_SUPPORTED_BEHAVIORS.map(behaviorName).join(", "), "End.DT4 can be the final CSID"],
          ]}
        />
        <p>IOS XR still uses a uDT4 at the end of a uSID carrier: as the <i>last</i> uSID it is never asked to shift, so no NEXT-CSID “flavor” is needed — it simply decapsulates. The guided lesson&apos;s program ({BASE_PROGRAM.length} segments) shows the same last-segment rule with End.DT4.</p>
      </GuideSection>

      <GuideSection id="ud-replace" eyebrow="Forwarding" title="REPLACE-CSID processing" tone="cyan">
        <p>REPLACE-CSID puts the first full SID in the destination and packs {REPLACE_LAYOUT.lnflBits}-bit CSIDs — {REPLACE_CAPACITY} per entry, with no block — into the SRH. An index in the destination&apos;s argument ({REPLACE_INDEX_BITS} bits) says which packed CSID comes next; each endpoint <i>replaces</i> the CSID in the destination and decrements the index. It suits CSIDs with real functions and long lists; NEXT-CSID suits short node identifiers. Both are standard; deployments pick one per domain.</p>
      </GuideSection>

      <GuideSection id="ud-giblib" eyebrow="Design" title="Global and local ID blocks" tone="violet">
        <DiagramFrame caption="Global IDs name nodes everywhere; local IDs name functions at one node.">
          <GibLibDiagram />
        </DiagramFrame>
        <p>Each node&apos;s 16-bit space is split: a global ID block for uN values routed domain-wide, and a local ID block (IOS XR: e000–efff) for uA, uDT and other functions that only make sense at that node. Local IDs can repeat across nodes — R6&apos;s e002 is a uA, R8&apos;s e002 is a uDT4 — because they are only ever read right after their node&apos;s uN.</p>
      </GuideSection>

      <GuideSection id="ud-size" eyebrow="Design" title="Header size and MTU" tone="danger">
        <DiagramFrame caption="Overhead per encoding.">
          <SizeDiagram />
        </DiagramFrame>
        <p>Overhead = 40 (outer IPv6) + SRH, and the SRH is 8 + 16 × (entries − 1) bytes when there is more than one entry. In the lab the core IPv6 MTU is 1500: a 1430-byte packet needs ≤ 70 bytes of overhead. Two carriers (64) fit; three (80) or classic (128) don&apos;t — the real reason the guided incident hurts.</p>
        <CliPanel run={ucCli(T.format, "R1", "show cef vrf CUST 10.8.1.10")} caption="IOS XR · R1 without the uSID format — six entries, 128 bytes" />
      </GuideSection>

      <GuideSection id="ud-control" eyebrow="Design" title="Control plane: advertising structure" tone="ospf">
        <DiagramFrame caption="IGP and BGP carry the SID structure the headend needs.">
          <ControlDiagram />
        </DiagramFrame>
        <p>Routers advertise their locators and SIDs in IS-IS (RFC 9352) with the SID structure attached; BGP service SIDs carry the same structure (RFC 9252). The headend only packs SIDs whose structure it knows — that is why a node whose locator isn&apos;t micro-segment, or whose structure is missing or inconsistent, ends up in an entry of its own.</p>
        <CliPanel run={ucCli(U0, "R4", "show isis segment-routing srv6 locators")} caption="IOS XR · R4 — the locator IS-IS advertises" />
      </GuideSection>

      <GuideSection id="ud-integration" eyebrow="Design" title="SR policy and TI-LFA with uSIDs" tone="mpls">
        <DiagramFrame caption="Policies, repairs and services all share the same carriers.">
          <IntegrationDiagram />
        </DiagramFrame>
        <p>An SR policy&apos;s segment list, a TI-LFA repair list and a VPN service SID are all just SIDs — with uSIDs they pack into the same carriers. A repair that would have added two 128-bit SIDs often fits into one carrier, which is a large part of why operators adopted uSID.</p>
      </GuideSection>

      <GuideSection id="ud-config" eyebrow="Operations" title="Configuring it on IOS XR" tone="mpls">
        <CliPanel run={ucBlock(U0, "R1", "show running-config", /^segment-routing/, /^ traffic-eng/)} caption="IOS XR · R1 — a micro-segment locator" />
        <CliPanel run={ucBlock(U0, "R1", "show running-config", /^ traffic-eng/, /^  policy GREEN/)} caption="IOS XR · R1 — uSID SID format and the segment list" />
        <FieldTable
          title="The statements"
          accent="mpls"
          columns={["Statement", "Where", "Effect"]}
          rows={[
            [<Mono key="1">micro-segment behavior unode psp-usd</Mono>, "segment-routing srv6 locators locator MAIN", "uSID locator: uN, uA, uDT SIDs"],
            [<Mono key="2">prefix fcbb:bb00:N::/48</Mono>, "same", "block + this node's uSID"],
            [<Mono key="3">sid-format usid-f3216</Mono>, "segment-routing traffic-eng segment-lists srv6", "the headend packs SIDs into carriers"],
            [<Mono key="4">index n sid X</Mono>, "segment-list PATH-A srv6", "the policy's SIDs, in order"],
            [<Mono key="5">segment-routing srv6 locator MAIN</Mono>, "router isis CORE address-family ipv6 unicast", "advertise the locator"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ud-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="Verification on IOS XR"
          accent="success"
          columns={["Question", "Command"]}
          rows={[
            ["Is the locator micro-segment?", <Mono key="1">show segment-routing srv6 locator (flag U)</Mono>],
            ["Which uSIDs does a SID carry?", <Mono key="2">show segment-routing srv6 sid &lt;sid&gt; detail</Mono>],
            ["SIDs and packed carriers", <Mono key="3">show segment-routing traffic-eng policy</Mono>],
            ["What is pushed, how many bytes?", <Mono key="4">show cef vrf CUST &lt;ip&gt;</Mono>],
            ["Is the active uSID routable?", <Mono key="5">show route ipv6 &lt;address&gt;</Mono>],
            ["Does a big packet fit?", <Mono key="6">ping vrf CUST &lt;ip&gt; size 1430</Mono>],
          ]}
        />
      </GuideSection>

      <GuideSection id="ud-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "CLS", title: "Classic node in the list", tone: "danger", points: ["an extra 128-bit entry", "big packets fail, path unchanged"] },
            { tag: "FMT", title: "Headend not packing", tone: "danger", points: ["one entry per SID", "SID format (none)"] },
            { tag: "ORD", title: "uSIDs out of order", tone: "warning", points: ["longer path, links crossed twice", "no drop"] },
            { tag: "LIB", title: "Stale local uSID", tone: "danger", points: ["drop at that node", "no route for the local value"] },
            { tag: "LOC", title: "Locator not advertised", tone: "warning", points: ["policy down (first SID)", "or drop in transit"] },
            { tag: "CAP", title: "List longer than planned", tone: "violet", points: ["more carriers than expected", "check the uSID count"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ud-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "What fails — size-dependent, or everything?", look: "Pings of 100 and 1430 bytes." },
            { question: "Is the policy up?", look: "show segment-routing traffic-eng policy." },
            { question: "Is every locator micro-segment and advertised?", look: "show segment-routing srv6 locator · show isis segment-routing srv6 locators." },
            { question: "How many entries does the headend push?", look: "show cef vrf CUST <ip> — entries and overhead." },
            { question: "Is the uSID order the path order?", look: "The packed list." },
            { question: "Do the local uSIDs still exist at their nodes?", look: "show segment-routing srv6 sid on those nodes." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ud-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk title="1 · Big packets die after R4's maintenance" normal="Two carriers, 64 bytes." change="R4's locator lost micro-segment; PATH-A got R4's classic SID." evidence={<CliPanel run={ucOnly(T.usidloc, "R1", "show cef vrf CUST 10.8.1.10", /SID-list|overhead/)} caption="IOS XR · R1 — three entries, 80 bytes" />} next="1430 + 80 > 1500: dropped at R1." fix={<Mono>R4: locator MAIN → micro-segment behavior unode psp-usd · R1: PATH-A index 30 sid fcbb:bb00:4:: → commit</Mono>} proof="Two carriers again; 1430 bytes delivered." />
        <FailureWalk title="2 · GREEN got slower" normal="uSIDs 2 3 4 5 6 e002." change="Index 30/40 swapped: 2 3 5 4 6 e002." evidence={<UcResult s={T.order} title="The lab: 15 ms via R4–R5 three times" />} next="Each uSID is executed where it sits." fix={<Mono>R1: PATH-A index 30 sid fcbb:bb00:4:: · index 40 sid fcbb:bb00:5:: → commit</Mono>} proof="11 ms over the express link." />
        <FailureWalk title="3 · GREEN dies at R6" normal="R6's uA toward R8 is e002." change="The new card re-created the adjacency: uA e003." evidence={<CliPanel run={ucOnly(T.stalelib, "R6", "show segment-routing srv6 sid", /uA/)} caption="IOS XR · R6 — e000, e001, e003: no e002" />} next="Active e002 at R6: no local SID, not routable." fix={<Mono>R1: PATH-A index 50 sid fcbb:bb00:6:e003:: → commit</Mono>} proof="Delivered over the express link." />
        <FailureWalk title="4 · GREEN down, everything else up" normal="R2 advertises fcbb:bb00:2::/48." change="R2's IS-IS lost segment-routing srv6 locator MAIN." evidence={<CliPanel run={ucOnly(T.r2loc, "R1", "show segment-routing traffic-eng policy", /Operational|Reason/)} caption="IOS XR · R1 — GREEN down: first SID unreachable" />} next="CUST falls back to the IGP path via R7 (14 ms)." fix={<Mono>R2: router isis CORE → address-family ipv6 unicast → segment-routing srv6 → locator MAIN → commit</Mono>} proof="GREEN up; 11 ms." />
        <FailureWalk title="5 · A new headend, a fatter header" normal="R1 packs with sid-format usid-f3216." change="The hand-restored config lost the SID format." evidence={<CliPanel run={ucOnly(T.format, "R1", "show segment-routing traffic-eng policy", /SID format|Packed/)} caption="IOS XR · R1 — no SID format: no packing" />} next="Six entries, 128 bytes; 1430 bytes fail." fix={<Mono>R1: segment-routing traffic-eng segment-lists srv6 → sid-format usid-f3216 → commit</Mono>} proof="Two carriers; 1430 bytes delivered." />
      </GuideSection>

      <GuideSection id="ud-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "Compression changes the path.", correction: "The program and the path are identical; only the encoding changes." },
            { myth: "A carrier is not a real IPv6 address.", correction: "It is — it routes to the owner of its first uSID." },
            { myth: "Segments Left drops at every node.", correction: "Only when a carrier is exhausted." },
            { myth: "Local uSIDs are unique network-wide.", correction: "They repeat; they mean something only at their node." },
            { myth: "One classic node breaks the policy.", correction: "It just costs a whole 128-bit entry." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ud-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="ud-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why are GREEN's six SIDs only two entries?", a: "They share the block fcbb:bb00; R1 writes it once per carrier followed by up to six 16-bit uSIDs." },
            { q: "How does R4 know the packet is for it?", a: "Its uN, 4, is the active uSID — the 16 bits right after the block." },
            { q: "What happens at R6?", a: "uN 6, shift, local uA e002, carrier exhausted: copy the next SRH entry (SL 1 → 0) and send it out of the express link." },
            { q: "Why does a classic SID cost so much?", a: "It can't share a carrier: it takes a whole 128-bit entry and splits the packing around it." },
            { q: "Why does a stale e002 drop at R6 and not earlier?", a: "Until R6 executes its uN, e002 isn't active; once it is, only R6 could interpret it — and it no longer has it." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ud-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "RFC 9800", def: "Compressed SRv6 Segment List Encoding (NEXT-CSID, REPLACE-CSID)." },
            { term: "LBL / LNL / FL / AL", def: "Locator-Block, Locator-Node, Function and Argument lengths." },
            { term: "Carrier", def: "A 128-bit entry holding the block and several uSIDs." },
            { term: "Shift", def: "Moving the remaining uSIDs left after executing the active one." },
            { term: "GIB / LIB", def: "Global and local ID blocks of a node's uSID space." },
            { term: "Mixed list", def: "A list combining packed carriers and ordinary 128-bit SIDs." },
            { term: "Reduced encapsulation", def: "First entry in the DA only, the rest in the SRH." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ud-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>A manifest with the company name written once and a row of stop numbers behind it. Each stop crosses off its own number; some numbers are private notes for the stop just made; a full line means turning the page; an old-style stop needs a line to itself.</p>
      </GuideSection>

      <GuideSection id="ud-practice" eyebrow="Master it" title="Practice in the SRv6 uSID Lab" tone="violet">
        <p>Six Learn levels, then the workspace: every router&apos;s locator and SIDs, R1&apos;s carriers and segment-list editor, IOS XR consoles, pings of 100 and 1430 bytes, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the SRv6 uSID / CSID presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
