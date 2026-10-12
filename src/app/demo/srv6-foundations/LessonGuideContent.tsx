import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import { DHeaderColumn, SRV6_HEX_POS, Srv6Topology, type Srv6Link } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { PracticeBridge } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, pickLines, runGuideCli } from "@/components/lesson/GuideCli";
import { STable } from "@/components/sp-lab/SpUi";
import { TO_R6, VIA_R3, createSxNet, endSid, sxApply, sxTicket, sxTicketState, type SxAction, type SxR, type SxRtr, type SxState } from "@/lib/sim-engine/scenarios/sxNet";
import { sxSets, sxStaticApi } from "./sx-lab/sxCli";

export const SRV6F_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "xl-mission", label: "What this lesson teaches" },
  { id: "xl-network", label: "The network of this lesson" },
  { id: "xl-ideas", label: "Three ideas you need" },
  { id: "xl-sid", label: "A SID is an address" },
  { id: "xl-locator", label: "Locator route vs local SID" },
  { id: "xl-underlay", label: "The underlay first" },
  { id: "xl-single", label: "One SID, no SRH" },
  { id: "xl-srh", label: "A segment list: the SRH" },
  { id: "xl-end", label: "End at work" },
  { id: "xl-three", label: "Three SIDs" },
  { id: "xl-path", label: "Same SID, another path" },
  { id: "xl-incident", label: "The missing-SID incident" },
  { id: "xl-mtu", label: "Room for the headers" },
  { id: "xl-working", label: "What working looks like" },
  { id: "xl-other", label: "Other ways it fails" },
  { id: "xl-model", label: "Mental model" },
  { id: "xl-glossary", label: "Glossary" },
  { id: "xl-recap", label: "Recap" },
  { id: "xl-practice", label: "Practice it" },
];

/** Real IOS XR output and test results on this page come from the SRv6 Foundations Lab — the guided lesson's hexagon. */
const X0: SxState = createSxNet(0);
const run = (s: SxState, ...a: SxAction[]) => a.reduce((acc, x) => sxApply(acc, x), s);
const set = (text: string, changes: { dev: SxR; f: (c: SxRtr) => void }[]): SxAction => ({ type: "set", text, changes });
const PLAIN = run(X0, { type: "plain" });
const ONE = run(X0, { type: "send", sids: TO_R6 });
const TWO = run(X0, { type: "send", sids: VIA_R3 });
const THREE = run(X0, { type: "send", sids: [endSid(5), endSid(3), endSid(6)] });
const MOVED = run(X0, set("R4–R5 metric 50", [{ dev: "R4", f: (c) => void (c.ifs["ge-0/0/1"]!.metric = 50) }, { dev: "R5", f: (c) => void (c.ifs["ge-0/0/0"]!.metric = 50) }]), { type: "send", sids: TO_R6 });
const INC = sxTicket("nosid").repro.reduce((acc, a) => sxApply(acc, a), sxTicketState("nosid", 0));
const INC_FIX = run(INC, set("R3: locator back in IS-IS, Loopback1 removed", [{ dev: "R3", f: (c) => void Object.assign(c, { isisLoc: true, lo1: false }) }]), { type: "send", sids: VIA_R3 });
const MTU = sxTicket("mtu").repro.reduce((acc, a) => sxApply(acc, a), sxTicketState("mtu", 0));
export function sxCli(s: SxState, r: SxR, command: string) {
  return runGuideCli(sxSets(sxStaticApi(s, r), r).cisco, command);
}
export function sxOnly(s: SxState, r: SxR, command: string, match: RegExp, keep = 0) {
  const x = sxCli(s, r, command);
  return { ...x, output: pickLines(x.output, match, keep) };
}
/** A block of an output: from the first line matching `start` up to the next line matching `stop`. */
export function sxBlock(s: SxState, r: SxR, command: string, start: RegExp, stop: RegExp) {
  const x = sxCli(s, r, command);
  const lines = x.output.split(NL);
  const i = lines.findIndex((l) => start.test(l));
  const j = lines.findIndex((l, k) => k > i && stop.test(l));
  return { ...x, output: lines.slice(i, j < 0 ? undefined : j).join(NL) };
}
const NL = String.fromCharCode(10);
/** One test, as the lab reports it. */
export function SxResult({ s, title }: { s: SxState; title: string }) {
  const t = s.tests[s.tests.length - 1];
  return (
    <Callout tone={t.ok ? "success" : "danger"} title={title} icon={t.ok ? "✓" : "!"}>
      {t.kind === "srv6" ? `H1 → H6 via [${t.sids.join(", ")}]` : t.kind === "plain" ? "H1 → H6, plain IPv6" : `ping ${t.dst} from ${t.from}`}: {t.ok ? `delivered via ${t.path.join(" → ")}` : t.why}
    </Callout>
  );
}
/** The headers of the last test, hop by hop, as the lab shows them. */
export function SxHeaders({ s }: { s: SxState }) {
  const t = s.tests[s.tests.length - 1];
  const rows = t.trace.map((h) => [h.from === h.to ? `at ${h.from}` : `${h.from} → ${h.to}`, h.outer ? h.da : `inner → ${h.da}`, h.sl === undefined ? (h.outer ? "no SRH" : "—") : String(h.sl), h.list ? h.list.map((x, i) => `[${i}] ${x}`).join(" ") : "—", `${h.bytes} B`]);
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border border-white/10 p-2">
      <STable cols={["Where", "Destination address", "Segments Left", "SRH Segment List", "Size"]} rows={rows} />
    </div>
  );
}

function LessonLabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SRv6 Foundations Lab" onPractice={openLab}>
      The hexagon of this lesson on IOS XR: locators, local SIDs, segment lists from R1 with the headers hop by hop, MTUs, your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

const LINKS: Srv6Link[] = [
  { a: "R1", b: "R2", label: "10" },
  { a: "R2", b: "R3", label: "10" },
  { a: "R3", b: "R6", label: "10" },
  { a: "R1", b: "R4", label: "5" },
  { a: "R4", b: "R5", label: "5" },
  { a: "R5", b: "R6", label: "5" },
];

function ActiveSegmentDiagram() {
  return (
    <DiagramSvg h={200} label="SR-MPLS: the active segment is the top label 16003 of the stack. SRv6: the active segment is the IPv6 destination address, and the SRH carries the rest of the program">
      <text x={160} y={20} textAnchor="middle" fill={D.mpls} fontSize={12} fontWeight={700}>
        SR-MPLS
      </text>
      <DStack x={160} y={36} labels={[{ text: "16003", color: D.warning, tag: "ACTIVE" }, { text: "16006" }]} payload="IP" w={110} />
      <text x={480} y={20} textAnchor="middle" fill={D.ip} fontSize={12} fontWeight={700}>
        SRv6
      </text>
      <DHeaderColumn
        x={480}
        y={36}
        w={190}
        rows={[
          { text: "IPv6 DA = R3 End SID", color: D.warning, tag: "ACTIVE", strong: true },
          { text: "SRH: SL 1 · LE 1", color: D.violet, tag: "SRH" },
          { text: "[0] R6 · [1] R3", color: D.violet },
          { text: "payload", color: D.ip },
        ]}
      />
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={10}>
        SR-MPLS reads the top label; SRv6 reads the IPv6 Destination Address
      </text>
      <text x={320} y={186} textAnchor="middle" fill={D.muted} fontSize={10}>
        the SRH is only the rest of the program, when one is needed
      </text>
    </DiagramSvg>
  );
}

function SidAnatomyDiagram() {
  const cell = (x: number, w: number, label: string, value: string, color: string) => (
    <g>
      <rect x={x} y={40} width={w} height={40} rx={6} fill={color} fillOpacity={0.14} stroke={color} strokeOpacity={0.8} />
      <text x={x + w / 2} y={57} textAnchor="middle" fill={color} fontSize={10.5} fontWeight={700}>
        {label}
      </text>
      <text x={x + w / 2} y={72} textAnchor="middle" fill={D.text} fontSize={10.5} fontFamily="monospace">
        {value}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={150} label="R3's End SID: 64-bit locator 2001:db8:100:3, 16-bit function 0x1, no argument bits, remaining bits zero, giving 2001:db8:100:3:1::">
      <text x={320} y={24} textAnchor="middle" fill={D.muted} fontSize={10}>
        128-bit SID = LOC : FUNCT : ARG (this lesson uses no ARG bits)
      </text>
      {cell(40, 300, "LOCATOR /64", "2001:db8:100:3", D.cyan)}
      {cell(346, 110, "FUNCT 16 bits", "0x1 (End)", D.warning)}
      {cell(462, 138, "remaining bits", "0 (ARG = 0 bits)", D.faint)}
      <text x={320} y={112} textAnchor="middle" fill={D.text} fontSize={12} fontWeight={700} fontFamily="monospace">
        = 2001:db8:100:3:1::
      </text>
      <text x={320} y={136} textAnchor="middle" fill={D.muted} fontSize={10}>
        R5 and R6 follow the same pattern: 2001:db8:100:5:1:: and 2001:db8:100:6:1::
      </text>
    </DiagramSvg>
  );
}

function TopologyDiagram() {
  return (
    <DiagramSvg h={240} label="Hexagon: top R1 R2 R3 R6 with metric 10 on each link, bottom R1 R4 R5 R6 with metric 5 on each link; R3, R5 and R6 own End SIDs">
      <Srv6Topology pos={SRV6_HEX_POS} links={LINKS} sub={{ R1: "headend", R3: "End :3:1::", R5: "End :5:1::", R6: "End :6:1::" }} accent={{ R1: D.ip, R3: D.warning, R5: D.warning, R6: D.warning }} boxW={84} />
      <text x={320} y={228} textAnchor="middle" fill={D.muted} fontSize={10}>
        numbers are IGP metrics · every node advertises its own locator 2001:db8:100:N::/64
      </text>
    </DiagramSvg>
  );
}

function SrhEncodingDiagram() {
  return (
    <DiagramSvg h={210} label="The program R3 then R6 is written left to right, but stored reversed: Segment List index 0 is R6, index 1 is R3; Last Entry 1, Segments Left 1, and the DA starts as R3's End SID">
      <text x={130} y={22} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        program (order of visit)
      </text>
      <text x={130} y={52} textAnchor="middle" fill={D.warning} fontSize={14} fontWeight={700} fontFamily="monospace">
        ⟨ R3 , R6 ⟩
      </text>
      <text x={130} y={74} textAnchor="middle" fill={D.muted} fontSize={10}>
        first → final
      </text>
      <DArrow x1={230} y1={50} x2={330} y2={50} color={D.faint} width={1.4} label="encode" />
      <DHeaderColumn
        x={470}
        y={22}
        w={210}
        rows={[
          { text: "DA = 2001:db8:100:3:1::", color: D.warning, tag: "IPv6 DA", strong: true },
          { text: "Segments Left = 1", color: D.violet, tag: "SL" },
          { text: "Last Entry = 1", color: D.violet, tag: "LE" },
          { text: "[0] 2001:db8:100:6:1:: (R6)", color: D.violet, tag: "final" },
          { text: "[1] 2001:db8:100:3:1:: (R3)", color: D.violet, tag: "first" },
          { text: "payload", color: D.ip },
        ]}
      />
      <text x={130} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        DA = Segment List[SL]
      </text>
      <text x={130} y={146} textAnchor="middle" fill={D.muted} fontSize={10}>
        LE = number of segments − 1
      </text>
    </DiagramSvg>
  );
}

function WalkDiagram() {
  const cols = [
    { x: 110, head: "R1 → R2", da: "DA R3 End", sl: "SL 1", note: "R1 FIB → R3's locator" },
    { x: 320, head: "R2 → R3", da: "DA R3 End", sl: "SL 1", note: "ordinary IPv6 transit" },
    { x: 530, head: "R3 → R6", da: "DA R6 End", sl: "SL 0", note: "after End at R3" },
  ];
  return (
    <DiagramSvg h={170} label="R1 to R2 and R2 to R3 carry DA R3 End with SL 1; R3 executes End, so R3 to R6 carries DA R6 End with SL 0; the Segment List never changes">
      {cols.map((c, i) => (
        <g key={c.head}>
          <text x={c.x} y={20} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
            {c.head}
          </text>
          <DHeaderColumn
            x={c.x}
            y={32}
            w={130}
            rows={[
              { text: c.da, color: D.warning, strong: true },
              { text: `${c.sl} · LE 1`, color: D.violet },
              { text: "[0] R6 · [1] R3", color: D.violet },
            ]}
            caption={c.note}
          />
          {i < cols.length - 1 && <DArrow x1={c.x + 72} y1={55} x2={c.x + 138} y2={55} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        storage order is never rewritten — only the DA and Segments Left change, and only at the SID&apos;s owner
      </text>
    </DiagramSvg>
  );
}

function FaultMethodDiagram() {
  const layers = ["interfaces / IGP", "locator route", "packet reaches owner", "local SID entry", "SRH / SL state"];
  return (
    <DiagramSvg h={120} label="Check layers bottom up: interfaces and IGP, the locator route, whether the packet reaches the owner, the owner's local SID entry, and the SRH state">
      {layers.map((l, i) => (
        <g key={l}>
          <rect x={20 + i * 124} y={34} width={112} height={40} rx={8} fill={D.box} stroke={D.cyan} strokeOpacity={0.6} />
          <text x={76 + i * 124} y={58} textAnchor="middle" fill={D.text} fontSize={10}>
            {l}
          </text>
          {i < layers.length - 1 && <DArrow x1={133 + i * 124} y1={54} x2={143 + i * 124} y2={54} color={D.faint} width={1.2} />}
        </g>
      ))}
      <text x={320} y={100} textAnchor="middle" fill={D.muted} fontSize={10}>
        check each layer with evidence before blaming the next one
      </text>
    </DiagramSvg>
  );
}


export function Srv6FoundationsLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="xl-mission" eyebrow="This lesson" title="What this lesson teaches" tone="mpls">
        <p>
          Every segment so far has been an MPLS label: a 20-bit number, meaningful only inside an SRGB, pushed and swapped by MPLS routers. This lesson keeps the segment routing ideas — segments, segment lists, a headend that writes the path into the packet — and moves them into the IPv6 data plane. In <b className="text-pv-text">SRv6</b> a segment is an IPv6 address: a <b className="text-pv-text">SID</b>.
        </p>
        <p>You will take a SID apart, follow one through a network of routers that know nothing about SRv6, build a segment list and watch the Segment Routing Header change hop by hop — and end with an incident where everything routes to R3 and R3 still throws the packet away.</p>
        <ChecklistCard tone="violet" title="By the end of this lesson you can" mark="→" items={["split a SID into locator and function and say what each does", "tell a locator route from a local SID", "explain why transit routers need only IPv6", "read an SRH: the reversed list, Segments Left, the active SID in the DA", "walk End, PSP and USD hop by hop", "find an SRv6 fault from evidence, fix it and prove it"]} />
      </GuideSection>

      <GuideSection id="xl-network" eyebrow="This lesson" title="The network of this lesson" tone="cyan">
        <DiagramFrame caption="The hexagon: the bottom is cheaper.">
          <TopologyDiagram />
        </DiagramFrame>
        <p>Six routers in a hexagon. The top (R1–R2–R3–R6) costs 10 per link, the bottom (R1–R4–R5–R6) 5 per link, so IS-IS sends everything to R6 over the bottom by default. Every router runs IS-IS for IPv6 and owns an SRv6 locator <Mono>2001:db8:100:N::/64</Mono>. H1 (<Mono>2001:db8:1::10</Mono>) sits behind R1, H6 (<Mono>2001:db8:6::20</Mono>) behind R6, and R1 can encapsulate H1&apos;s traffic with any segment list.</p>
        <Callout tone="cyan" title="IOS XR in the lab" icon="i">
          The SRv6 Foundations Lab runs IOS XR on every router: <Mono>segment-routing srv6 locators</Mono>, the locator under <Mono>router isis</Mono>, and an encapsulation source address on R1. Junos implements the same RFCs under <Mono>routing-options source-packet-routing srv6</Mono>; this lesson shows IOS XR only.
        </Callout>
      </GuideSection>

      <GuideSection id="xl-ideas" eyebrow="This lesson" title="Three ideas you need" tone="violet">
        <CompareCards
          items={[
            { title: "SID", tone: "violet", tag: "the instruction", points: ["locator: where", "function: what"] },
            { title: "Plain IPv6 transit", tone: "mpls", tag: "the underlay", points: ["forward on the DA", "no SRv6 needed"] },
            { title: "SRH", tone: "warning", tag: "the program", points: ["list stored in reverse", "Segments Left: what's next"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="xl-sid" eyebrow="The SID" title="A SID is an address" tone="violet">
        <DiagramFrame caption="Locator, then function.">
          <SidAnatomyDiagram />
        </DiagramFrame>
        <p>R3&apos;s End SID <Mono>2001:db8:100:3:1::</Mono> is 64 bits of locator (<Mono>2001:db8:100:3</Mono>) and a function (<Mono>1</Mono>). Function 1 means <b className="text-pv-text">End</b>: “I am an endpoint — move on to the next segment.” IS-IS allocated it, together with one <b className="text-pv-text">End.X</b> SID per adjacency (“move on, and leave through this link”).</p>
        <CliPanel run={sxCli(X0, "R3", "show segment-routing srv6 sid")} caption="IOS XR · R3 — its local SID table: End and two End.X" />
      </GuideSection>

      <GuideSection id="xl-locator" eyebrow="The SID" title="Locator route vs local SID" tone="warning">
        <p>Two different things make a SID work. The <b className="text-pv-text">locator route</b> — R3 advertises <Mono>2001:db8:100:3::/64</Mono> in IS-IS — answers “how do I get to R3?” for every router. The <b className="text-pv-text">local SID entry</b> on R3 answers “what does R3 do with this exact address?”. An address inside the locator that R3 hasn&apos;t instantiated is routed to R3 and dropped there.</p>
        <CliPanel run={sxOnly(X0, "R1", "show isis database verbose R3.00-00", /LSPID|^R3|SRv6 Locator|END SID|End\.X SID/)} caption="IOS XR · R1 reading R3's LSP — the SRv6 Locator TLV with the End SID, and End.X SIDs on its adjacencies" />
      </GuideSection>

      <GuideSection id="xl-underlay" eyebrow="The underlay" title="The underlay first" tone="success">
        <p>Before any SRv6, IS-IS has to route IPv6. H1 → H6 takes the bottom, cost 15. The same IS-IS also installs every locator: R1 reaches R6&apos;s SIDs through the route for <Mono>2001:db8:100:6::/64</Mono>.</p>
        <SxResult s={PLAIN} title="The lab: H1 → H6, plain IPv6" />
        <CliPanel run={sxCli(X0, "R1", "show route ipv6 2001:db8:100:6:1::")} caption="IOS XR · R1 — R6's SID is reached through R6's locator route, toward R4" />
      </GuideSection>

      <GuideSection id="xl-single" eyebrow="One SID" title="One SID, no SRH" tone="mpls">
        <p>R1 encapsulates H1&apos;s packet: an outer IPv6 header with source <Mono>2001:db8::1</Mono> (its <Mono>encapsulation source-address</Mono>) and destination R6&apos;s End SID. One segment needs no SRH. R4 and R5 forward on the destination address like any IPv6 packet. R6 matches it in its local SID table — End, with no segments left — removes the outer header (<b className="text-pv-text">USD</b>) and delivers the original packet.</p>
        <SxResult s={ONE} title="The lab: H1 → H6 via [R6 End]" />
        <SxHeaders s={ONE} />
      </GuideSection>

      <GuideSection id="xl-srh" eyebrow="A segment list" title="A segment list: the SRH" tone="violet">
        <DiagramFrame caption="Written left to right, stored right to left.">
          <SrhEncodingDiagram />
        </DiagramFrame>
        <p>For <Mono>[R3 End, R6 End]</Mono> R1 adds a <b className="text-pv-text">Segment Routing Header</b> (RFC 8754). The list is stored in reverse — the last segment at index 0 — and <b className="text-pv-text">Segments Left</b> says how many are still to execute. The active segment is always in the destination address; routers forward on that.</p>
        <DiagramFrame caption="Where the active segment lives: the top label vs the destination address.">
          <ActiveSegmentDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="Reduced encapsulation" icon="i">
          The guided lesson shows the full SRH, with every segment in the list. IOS XR uses <b>H.Encaps.Red</b> by default: the first SID lives only in the destination address, so the SRH here holds just R6&apos;s SID, with Segments Left 1. It saves 16 bytes; the processing is identical.
        </Callout>
        <SxResult s={TWO} title="The lab: H1 → H6 via [R3 End, R6 End]" />
      </GuideSection>

      <GuideSection id="xl-end" eyebrow="End" title="End at work" tone="success">
        <DiagramFrame caption="Segments Left changes only where a SID is executed.">
          <WalkDiagram />
        </DiagramFrame>
        <p>R2 forwards on the DA (R3&apos;s SID) and changes nothing else. R3 matches its End SID: Segments Left 1 → 0, copy Segment List[0] — R6&apos;s SID — into the DA. With nothing left, R3 removes the SRH (<b className="text-pv-text">PSP</b>, penultimate segment pop). R6 then does End with no segments left: USD, deliver.</p>
        <SxHeaders s={TWO} />
      </GuideSection>

      <GuideSection id="xl-three" eyebrow="End" title="Three SIDs" tone="mpls">
        <p>With <Mono>[R5, R3, R6]</Mono> the packet takes the bottom to R5. R5&apos;s End sets the DA to R3&apos;s SID — and R5&apos;s best route to R3&apos;s locator goes through R6. R6 forwards it as a transit router: the DA isn&apos;t its SID. R3 executes End and the packet comes back to R6 to finish. A node is an endpoint only when the DA is one of its SIDs.</p>
        <SxResult s={THREE} title="The lab: H1 → H6 via [R5 End, R3 End, R6 End]" />
      </GuideSection>

      <GuideSection id="xl-path" eyebrow="Behavior" title="Same SID, another path" tone="cyan">
        <p>Raise R4–R5 to metric 50 and the best route to R6&apos;s locator moves to the top. Send to R6&apos;s End SID again: same SID, same encapsulation, different path. A SID names a node and an instruction; how the packet gets there is ordinary routing.</p>
        <SxResult s={MOVED} title="The lab: [R6 End] after R4–R5 became expensive" />
      </GuideSection>

      <GuideSection id="xl-incident" eyebrow="Incident" title="The missing-SID incident" tone="danger">
        <p>The guided lesson&apos;s incident: traffic steered through R3 disappears; plain IPv6 and the default path work. R3 was migrated last night, and its locator range still answers a ping to <Mono>2001:db8:100:3::1</Mono>.</p>
        <DiagramFrame caption="Check the layers in order.">
          <FaultMethodDiagram />
        </DiagramFrame>
        <SxResult s={INC} title="The lab: [R3 End, R6 End] (the ticket)" />
        <TroubleshootingFlow
          steps={[
            { question: "Does the packet reach R3?", look: "Yes — R1 and R2 route it on 2001:db8:100:3::/64." },
            { question: "Who advertises that /64?", look: "R3 — but as a plain Loopback1 prefix, not as an SRv6 locator." },
            { question: "Does R3 have the SID?", look: "No: its local SID table is empty." },
            { question: "Why?", look: "The locator is no longer enabled under IS-IS, so no End SID was allocated." },
          ]}
        />
        <CliPanel run={sxCli(INC, "R3", "show isis segment-routing srv6 locators")} caption="IOS XR · R3 — IS-IS advertises no SRv6 locator, so no End SID was allocated" />
        <CliPanel run={sxCli(INC, "R1", "ping 2001:db8:100:3:1::")} caption="IOS XR · R1 — the SID doesn't answer (the Loopback1 address does)" />
        <CliPanel run={{ prompt: "RP/0/RP0/CPU0:R3(config)#", command: "router isis CORE address-family ipv6 unicast segment-routing srv6", output: "RP/0/RP0/CPU0:R3(config-isis-srv6)#locator MAIN\nRP/0/RP0/CPU0:R3(config-isis-srv6)#root\nRP/0/RP0/CPU0:R3(config)#router isis CORE\nRP/0/RP0/CPU0:R3(config-isis)#no interface Loopback1\nRP/0/RP0/CPU0:R3(config-isis)#root\nRP/0/RP0/CPU0:R3(config)#no interface Loopback1\nRP/0/RP0/CPU0:R3(config)#commit" }} caption="IOS XR · R3 — the repair" />
        <SxResult s={INC_FIX} title="The lab: a fresh test after the fix" />
        <ChecklistCard tone="success" title="Proved, not assumed" mark="✓" items={["R3's End SID is back in its local SID table", "R3's locator is advertised as a locator again", "[R3 End, R6 End] reaches H6 over the top"]} />
      </GuideSection>

      <GuideSection id="xl-mtu" eyebrow="Operations" title="Room for the headers" tone="warning">
        <p>Encapsulation makes packets bigger: 40 bytes of outer header, plus 8 + 16 per SRH entry. A 1460-byte packet fits a 1500-byte IPv6 MTU on its own, but with two SIDs it is 1524 bytes. SRv6 cores run jumbo MTUs (here <Mono>mtu 9216</Mono>) for exactly this reason — one link left at the default and big packets vanish.</p>
        <SxResult s={MTU} title="The lab: 1460 bytes via [R5 End, R6 End] with R4's MTU at 1514" />
      </GuideSection>

      <GuideSection id="xl-working" eyebrow="Evidence" title="What working looks like" tone="success">
        <FieldTable
          title="Healthy, in five questions (IOS XR)"
          accent="success"
          columns={["Question", "Command", "Healthy answer"]}
          rows={[
            ["Does the router own its SIDs?", <Mono key="1">show segment-routing srv6 sid</Mono>, "End + End.X per adjacency, InUse"],
            ["Is the locator advertised?", <Mono key="2">show isis segment-routing srv6 locators</Mono>, "MAIN · 2001:db8:100:N::/64 · Active"],
            ["Can the headend reach the SID?", <Mono key="3">show route ipv6 &lt;sid&gt;</Mono>, "the owner's locator route"],
            ["Can the headend encapsulate?", <Mono key="4">show segment-routing srv6 manager</Mono>, "source address 2001:db8::1"],
            ["Does it work?", "a test from R1 / ping <sid>", "delivered / !!!!!"],
          ]}
        />
      </GuideSection>

      <GuideSection id="xl-other" eyebrow="Beyond this incident" title="Other ways it fails" tone="warning">
        <FailureSignatures
          items={[
            { tag: "PFX", title: "Wrong locator prefix", tone: "danger", points: ["documented SID has no route", "dropped at the headend"] },
            { tag: "ISIS", title: "Locator not in IS-IS", tone: "danger", points: ["locator Up locally", "no route anywhere, no SID"] },
            { tag: "ENC", title: "No encapsulation source", tone: "violet", points: ["nothing leaves the headend"] },
            { tag: "MTU", title: "No headroom", tone: "warning", points: ["small packets fine", "big ones: Packet Too Big"] },
          ]}
        />
        <p className="text-sm text-pv-text-muted">Each is a ticket in the SRv6 Foundations Lab, together with this incident.</p>
      </GuideSection>

      <GuideSection id="xl-model" eyebrow="Mental model" title="Mental model" tone="cyan">
        <p>
          Think of SRv6 SIDs as street addresses with an apartment number. The street part (the locator) is on every map: any driver can get you to the building without knowing anyone inside. The apartment number (the function) only means something to the building&apos;s concierge, who keeps a list of which apartments are occupied and what to do with mail for each (the local SID table). A courier with several stops carries a sealed itinerary (the SRH), reads it backwards, and keeps the next address on the outside of the envelope (the DA) so drivers on the way just follow street signs. At each building the concierge crosses off a stop and writes the next address on the envelope; at the last stop they open the envelope and hand over the letter inside. And if the building is still on the map but the apartment is empty, the mail comes back.
        </p>
        <Callout tone="cyan" title="When it breaks, ask in this order" icon="→">
          Does plain IPv6 work? Can the headend encapsulate? Is every locator advertised, with the documented prefix? Does every SID in the list exist on its owner? Is there room for the headers?
        </Callout>
      </GuideSection>

      <GuideSection id="xl-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "SID", def: "A 128-bit IPv6 address bound to a behavior on the node that instantiated it." },
            { term: "Locator", def: "The routable prefix of a node's SIDs (here a /64)." },
            { term: "Function", def: "The bits after the locator that select the behavior." },
            { term: "Local SID table", def: "A node's instantiated SIDs and their behaviors." },
            { term: "SRH", def: "Segment Routing Header (RFC 8754): Segment List (reversed), Segments Left, Last Entry." },
            { term: "End / End.X", def: "Endpoint: next segment / next segment out of a given link (RFC 8986)." },
            { term: "PSP / USD", def: "Penultimate segment pop (remove the SRH) / ultimate segment decapsulation (remove the outer header)." },
            { term: "H.Encaps.Red", def: "Headend encapsulation with the first SID only in the DA." },
          ]}
        />
      </GuideSection>

      <GuideSection id="xl-recap" eyebrow="Reference" title="Recap" tone="success">
        <ChecklistCard tone="success" title="You can now" mark="✓" items={["split a SID into locator and function", "tell a locator route from a local SID", "explain plain-IPv6 transit", "read an SRH and Segments Left", "walk End, PSP and USD", "find, fix and prove a missing SID"]} />
      </GuideSection>

      <GuideSection id="xl-practice" eyebrow="Next" title="Practice it" tone="violet">
        <p>The Deep Dive tab covers SRv6 in full: the network-programming model, SID structure and allocation, IS-IS SRv6 TLVs, the SRH fields, End and its flavors, headend encapsulation modes, MTU and hop limit, ICMPv6, configuration and verification on IOS XR, and every failure signature with real evidence. The lab lets you send the packets yourself.</p>
        <LessonLabBridge />
        <PresentationBridge>Rewatch the SRv6 Foundations presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
