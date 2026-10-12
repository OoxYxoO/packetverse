import { CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FailureSignatures, FieldTable, Glossary, GuideSection, Misconceptions, Mono, TroubleshootingFlow } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ExplainIt, KnowledgeQuiz, PracticeBridge, type KnowledgeQuestion } from "@/components/lesson/GuideInteractive";
import { usePracticeLabOpener } from "@/components/lesson/FundamentalsLessonShell";
import { PresentationBridge } from "@/components/presentation/LessonPresentation";
import { CliPanel, FailureWalk } from "@/components/lesson/GuideCli";
import { createSxNet, sxApply, sxTicket, sxTicketState, type SxAction, type SxState, type SxTicketId } from "@/lib/sim-engine/scenarios/sxNet";
import { SxHeaders, SxResult, sxBlock, sxCli, sxOnly } from "./LessonGuideContent";

const G = { foundation: "Foundation", sid: "SIDs", srh: "The SRH", beh: "Behaviors", ops: "Operations", trouble: "Troubleshooting", master: "Master it" };
export const SRV6F_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "xd-why", label: "Why SRv6", group: G.foundation },
  { id: "xd-program", label: "Network programming", group: G.foundation },
  { id: "xd-roles", label: "Headend, transit, endpoint", group: G.foundation },
  { id: "xd-structure", label: "SID structure", group: G.sid },
  { id: "xd-alloc", label: "Locators and allocation", group: G.sid },
  { id: "xd-isis", label: "IS-IS SRv6 advertisements", group: G.sid },
  { id: "xd-srh", label: "SRH fields", group: G.srh },
  { id: "xd-sl", label: "Segments Left, step by step", group: G.srh },
  { id: "xd-encap", label: "Headend encapsulation modes", group: G.srh },
  { id: "xd-end", label: "End and End.X", group: G.beh },
  { id: "xd-flavors", label: "PSP, USP and USD", group: G.beh },
  { id: "xd-services", label: "What comes next: service SIDs", group: G.beh },
  { id: "xd-mtu", label: "MTU, hop limit and ICMPv6", group: G.ops },
  { id: "xd-config", label: "Configuring it on IOS XR", group: G.ops },
  { id: "xd-verify", label: "How to verify", group: G.ops },
  { id: "xd-signatures", label: "Failure signatures", group: G.trouble },
  { id: "xd-ladder", label: "The troubleshooting ladder", group: G.trouble },
  { id: "xd-tickets", label: "Five faults, evidence to proof", group: G.trouble },
  { id: "xd-myths", label: "Common misconceptions", group: G.master },
  { id: "xd-quiz", label: "Knowledge check", group: G.master },
  { id: "xd-explain", label: "Can you explain it?", group: G.master },
  { id: "xd-glossary", label: "Glossary", group: G.master },
  { id: "xd-mental", label: "Mental model", group: G.master },
  { id: "xd-practice", label: "Practice in the SRv6 Foundations Lab", group: G.master },
];

// Real IOS XR output and test results: the SRv6 Foundations Lab's command set and model.
const X0: SxState = createSxNet(0);
const run = (s: SxState, ...a: SxAction[]) => a.reduce((acc, x) => sxApply(acc, x), s);
const ticket = (id: SxTicketId) => sxTicket(id).repro.reduce((acc, a) => sxApply(acc, a), sxTicketState(id, 1));
const T = { nosid: ticket("nosid"), locator: ticket("locator"), notisis: ticket("notisis"), encap: ticket("encap"), mtu: ticket("mtu") };
const ENDX = run(X0, { type: "send", sids: ["2001:db8:100:4:41::", "2001:db8:100:6:1::"] });
const NOTSID = run(X0, { type: "send", sids: ["2001:db8:100:3:9::", "2001:db8:100:6:1::"] });

function LabBridge() {
  const openLab = usePracticeLabOpener();
  return (
    <PracticeBridge label="Open the SRv6 Foundations Lab" onPractice={openLab}>
      SRv6 on IOS XR, segment lists from R1 with the headers hop by hop, MTUs and pings — your own copy. Nothing you do there changes your lesson progress.
    </PracticeBridge>
  );
}

function ProgrammingDiagram() {
  return (
    <DiagramSvg h={170} label="A network program: an ordered list of SIDs; each SID is an instruction, located by its locator and executed by the node that instantiated it">
      <text x={320} y={22} textAnchor="middle" fill={D.muted} fontSize={10}>
        a packet carries a program: an ordered list of instructions
      </text>
      {["SID 1", "SID 2", "SID 3"].map((s, i) => (
        <g key={s}>
          <DPill x={160 + i * 160} y={56} text={s} color={D.warning} w={110} />
          {i < 2 && <DArrow x1={219 + i * 160} y1={56} x2={259 + i * 160} y2={56} color={D.faint} width={1.4} />}
        </g>
      ))}
      <DNode x={180} y={128} label="LOCATOR" sub="where: route to the owner" accent={D.cyan} w={200} />
      <DNode x={460} y={128} label="FUNCTION (+ ARG)" sub="what: the owner's behavior" accent={D.violet} w={220} />
      <DArrow x1={160} y1={70} x2={180} y2={104} color={D.cyan} width={1.2} />
      <DArrow x1={160} y1={70} x2={440} y2={104} color={D.violet} width={1.2} />
    </DiagramSvg>
  );
}

function RolesDiagram() {
  const nodes = [
    { x: 80, label: "Headend", sub: "builds the program", c: D.ip },
    { x: 240, label: "Transit", sub: "plain IPv6 FIB", c: D.faint },
    { x: 400, label: "Endpoint", sub: "runs its SID", c: D.warning },
    { x: 560, label: "Endpoint", sub: "final segment", c: D.success },
  ];
  return (
    <DiagramSvg h={120} label="Headend builds the program, transit nodes forward by ordinary IPv6 lookup, endpoint nodes execute their own SIDs, the final endpoint ends the program">
      {nodes.map((n, i) => (
        <g key={`${n.label}-${i}`}>
          <DNode x={n.x} y={50} label={n.label} sub={n.sub} accent={n.c} w={130} />
          {i < nodes.length - 1 && <DArrow x1={n.x + 67} y1={50} x2={n.x + 93} y2={50} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={320} y={104} textAnchor="middle" fill={D.muted} fontSize={10}>
        only a node whose Local SID Table matches the DA changes the packet&apos;s program
      </text>
    </DiagramSvg>
  );
}

function SidStructureDiagram() {
  const parts = [
    { x: 40, w: 200, t: "B — SID block", s: "e.g. 2001:db8:100::/48", c: D.cyan },
    { x: 246, w: 120, t: "N — node", s: "per node", c: D.ip },
    { x: 372, w: 120, t: "FUNCT", s: "behavior id", c: D.warning },
    { x: 498, w: 102, t: "ARG", s: "optional", c: D.faint },
  ];
  return (
    <DiagramSvg h={130} label="A SID is locator (SID block plus node id), then function, then an optional argument">
      {parts.map((p) => (
        <g key={p.t}>
          <rect x={p.x} y={30} width={p.w} height={46} rx={6} fill={p.c} fillOpacity={0.14} stroke={p.c} strokeOpacity={0.8} />
          <text x={p.x + p.w / 2} y={50} textAnchor="middle" fill={p.c} fontSize={10.5} fontWeight={700}>
            {p.t}
          </text>
          <text x={p.x + p.w / 2} y={66} textAnchor="middle" fill={D.muted} fontSize={9.5}>
            {p.s}
          </text>
        </g>
      ))}
      <line x1={40} y1={92} x2={366} y2={92} stroke={D.cyan} strokeWidth={1.5} />
      <text x={203} y={108} textAnchor="middle" fill={D.cyan} fontSize={10} fontWeight={700}>
        LOCATOR = B + N (the routable part)
      </text>
      <text x={486} y={108} textAnchor="middle" fill={D.muted} fontSize={10}>
        unused low-order bits are zero
      </text>
    </DiagramSvg>
  );
}

function SrhLayoutDiagram() {
  const row = (y: number, cells: { w: number; t: string; c: string }[]) => {
    let x = 80;
    return cells.map((cell) => {
      const g = (
        <g key={`${y}-${cell.t}`}>
          <rect x={x} y={y} width={cell.w} height={26} fill={cell.c} fillOpacity={0.12} stroke={cell.c} strokeOpacity={0.7} />
          <text x={x + cell.w / 2} y={y + 17} textAnchor="middle" fill={cell.c} fontSize={10} fontWeight={700}>
            {cell.t}
          </text>
        </g>
      );
      x += cell.w;
      return g;
    });
  };
  return (
    <DiagramSvg h={230} label="SRH layout: Next Header, Hdr Ext Len, Routing Type 4, Segments Left; Last Entry, Flags, Tag; Segment List 0 to n, each 128 bits; optional TLVs">
      <text x={320} y={18} textAnchor="middle" fill={D.muted} fontSize={10}>
        SRH (RFC 8754) — 32 bits per row
      </text>
      {row(28, [
        { w: 120, t: "Next Header", c: D.ip },
        { w: 120, t: "Hdr Ext Len", c: D.ip },
        { w: 120, t: "Routing Type = 4", c: D.violet },
        { w: 120, t: "Segments Left", c: D.warning },
      ])}
      {row(54, [
        { w: 120, t: "Last Entry", c: D.warning },
        { w: 120, t: "Flags", c: D.faint },
        { w: 240, t: "Tag", c: D.faint },
      ])}
      {row(80, [{ w: 480, t: "Segment List[0] — 128 bits (the final segment)", c: D.violet }])}
      {row(106, [{ w: 480, t: "…", c: D.violet }])}
      {row(132, [{ w: 480, t: "Segment List[n] — 128 bits (the first segment)", c: D.violet }])}
      {row(158, [{ w: 480, t: "optional TLVs (e.g. padding, HMAC)", c: D.faint }])}
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        Hdr Ext Len counts 8-octet units after the first 8 octets
      </text>
    </DiagramSvg>
  );
}

function SlTimelineDiagram() {
  const stages = [
    { x: 100, h: "at headend", da: "DA = S1", sl: "SL 2" },
    { x: 260, h: "End at S1 owner", da: "DA = S2", sl: "SL 1" },
    { x: 420, h: "End at S2 owner", da: "DA = S3", sl: "SL 0" },
    { x: 570, h: "S3 owner", da: "DA = S3", sl: "SL 0 · final" },
  ];
  return (
    <DiagramSvg h={150} label="Program S1 S2 S3: the headend sets DA S1 and SL 2; each endpoint decrements SL and copies the next SID into the DA; at SL 0 the final owner stops advancing">
      {stages.map((s, i) => (
        <g key={s.h}>
          <text x={s.x} y={20} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
            {s.h}
          </text>
          <DHeaderColumn x={s.x} y={32} w={120} rows={[{ text: s.da, color: D.warning, strong: true }, { text: s.sl, color: D.violet }]} />
          {i < stages.length - 1 && <DArrow x1={s.x + 64} y1={55} x2={stages[i + 1].x - 64} y2={55} color={D.faint} width={1.2} />}
        </g>
      ))}
      <text x={320} y={112} textAnchor="middle" fill={D.muted} fontSize={10}>
        Segment List storage: [0] S3 · [1] S2 · [2] S1 — unchanged on every hop
      </text>
      <text x={320} y={130} textAnchor="middle" fill={D.muted} fontSize={10}>
        transit routers between endpoints change none of it
      </text>
    </DiagramSvg>
  );
}


const QUIZ: KnowledgeQuestion[] = [
  { id: "q-sid", prompt: "Is every IPv6 address inside R3's locator a SID?", options: [{ id: "a", label: "No — only the ones R3 has instantiated" }, { id: "b", label: "Yes" }, { id: "c", label: "Only those ending in ::1" }], correctId: "a", explanation: "The local SID table decides; the rest of the locator is just routed to R3." },
  { id: "q-transit", prompt: "What does a transit router need to forward an SRv6 packet?", options: [{ id: "a", label: "An IPv6 route for the destination address" }, { id: "b", label: "SRv6 enabled" }, { id: "c", label: "The SRH parsed" }], correctId: "a", explanation: "Only the node owning the active SID processes the SRH." },
  { id: "q-active", prompt: "Where is the active segment of an SRv6 packet?", options: [{ id: "a", label: "In the IPv6 destination address" }, { id: "b", label: "At Segment List[0]" }, { id: "c", label: "In the flow label" }], correctId: "a", explanation: "Segment List[0] is the last segment; the active one is copied into the DA." },
  { id: "q-sl", prompt: "R2 forwards a packet whose DA is R3's SID. What happens to Segments Left?", options: [{ id: "a", label: "Nothing" }, { id: "b", label: "It decreases by one" }, { id: "c", label: "It resets" }], correctId: "a", explanation: "Segments Left changes only at the endpoint executing the SID." },
  { id: "q-psp", prompt: "What does PSP do?", options: [{ id: "a", label: "The penultimate endpoint removes the SRH after updating the DA to the last SID" }, { id: "b", label: "It pops an MPLS label" }, { id: "c", label: "The last endpoint removes the outer header" }], correctId: "a", explanation: "Removing the outer header is USD." },
  { id: "q-mtu", prompt: "1460-byte packet, two SIDs, reduced encapsulation. How big on the wire?", options: [{ id: "a", label: "1524 bytes" }, { id: "b", label: "1500 bytes" }, { id: "c", label: "1460 bytes" }], correctId: "a", explanation: "1460 + 40 (outer header) + 8 + 16 (SRH with one entry)." },
];

export function Srv6FoundationsDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="xd-why" eyebrow="Foundation" title="Why SRv6" tone="mpls">
        <p>SR-MPLS brought source routing to MPLS networks, but it still needs MPLS everywhere: label tables, an SRGB, MPLS-capable transit. <b className="text-pv-text">SRv6</b> (RFC 8402 for the architecture, RFC 8754 for the header, RFC 8986 for the behaviors) uses IPv6 itself as the data plane. Segments become IPv6 addresses, transit routers just route IPv6, and a SID can carry far more than “go here” — the function bits can name services, tables, cross-connects. One header serves transport and services.</p>
      </GuideSection>

      <GuideSection id="xd-program" eyebrow="Foundation" title="Network programming" tone="violet">
        <DiagramFrame caption="A program: an ordered list of instructions, each located and executed by its owner.">
          <ProgrammingDiagram />
        </DiagramFrame>
        <p>RFC 8986 calls a segment list a <b className="text-pv-text">network program</b>: each SID is an instruction (LOC:FUNCT:ARG), the locator says which node executes it, the function says what that node does. The headend writes the program; endpoints execute their instructions in order.</p>
      </GuideSection>

      <GuideSection id="xd-roles" eyebrow="Foundation" title="Headend, transit, endpoint" tone="cyan">
        <DiagramFrame caption="Three roles, one packet.">
          <RolesDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who does what"
          accent="cyan"
          columns={["Role", "Looks at", "Does"]}
          rows={[
            ["Headend (R1)", "its policy / steering", "encapsulates: outer header, DA = first SID, SRH with the rest"],
            ["Transit (R2, R4, R5…)", "the destination address", "ordinary IPv6 longest match — needs no SRv6"],
            ["Endpoint (owner of the active SID)", "its local SID table", "executes the behavior: End, End.X, …"],
          ]}
        />
      </GuideSection>

      <GuideSection id="xd-structure" eyebrow="SIDs" title="SID structure" tone="violet">
        <DiagramFrame caption="Block + node id = locator, then function, then argument.">
          <SidStructureDiagram />
        </DiagramFrame>
        <p>A SID is <b className="text-pv-text">locator : function : argument</b>. The locator is often a SID block (here <Mono>2001:db8:100::/48</Mono>) plus a node id (<Mono>3</Mono>), making a /64 per node. The function picks the behavior; the argument, when a behavior uses one, carries per-packet data. This lab uses the classic layout — /64 locator, 16-bit function, no argument; compressed SIDs (uSID) change the sizes, not the idea.</p>
      </GuideSection>

      <GuideSection id="xd-alloc" eyebrow="SIDs" title="Locators and allocation" tone="mpls">
        <p>The locator is configured; SIDs are allocated under it. On IOS XR, enabling a locator in IS-IS makes IS-IS allocate the node&apos;s End SID (function 1) and an End.X SID per adjacency (from 0x40). A SID that nobody allocated doesn&apos;t exist, even though it is routable:</p>
        <SxResult s={NOTSID} title="The lab: a segment list starting with 2001:db8:100:3:9::" />
        <CliPanel run={sxCli(X0, "R5", "show segment-routing srv6 locator")} caption="IOS XR · R5 — locator MAIN, its prefix and status" />
      </GuideSection>

      <GuideSection id="xd-isis" eyebrow="SIDs" title="IS-IS SRv6 advertisements" tone="cyan">
        <FieldTable
          title="What IS-IS carries for SRv6 (RFC 9352)"
          accent="cyan"
          columns={["TLV / sub-TLV", "Carries"]}
          rows={[
            ["SRv6 Capabilities (Router Capability)", "the node supports SRv6; flags"],
            ["Node MSD", "how many SIDs it can process / push (SRH Max SL, Max H.encaps…)"],
            ["SRv6 Locator TLV (27)", "the locator prefix, metric, algorithm — and End SIDs as sub-TLVs"],
            ["SRv6 End.X SID (sub-TLV of the IS neighbor)", "the End.X SID of an adjacency"],
          ]}
        />
        <CliPanel run={sxOnly(X0, "R1", "show isis database verbose R5.00-00", /SRv6|SRH Max|END SID|End\.X|Behavior/)} caption="IOS XR · R1 reading R5's LSP" />
        <p>The locator is also installed as an ordinary IPv6 route — which is what lets non-SRv6 routers forward toward it.</p>
      </GuideSection>

      <GuideSection id="xd-srh" eyebrow="The SRH" title="SRH fields" tone="violet">
        <DiagramFrame caption="Routing header type 4.">
          <SrhLayoutDiagram />
        </DiagramFrame>
        <FieldTable
          title="SRH fields (RFC 8754)"
          accent="violet"
          columns={["Field", "Meaning"]}
          rows={[
            ["Next Header", "what follows the SRH (the inner IPv6 header: 41)"],
            ["Hdr Ext Len", "length in 8-byte units, not counting the first 8"],
            ["Routing Type", "4 = Segment Routing"],
            ["Segments Left", "how many segments are still to execute; index of the next one"],
            ["Last Entry", "index of the last element of the list (the first segment)"],
            ["Flags, Tag", "unused here"],
            ["Segment List[0..n]", "the SIDs, last segment first"],
          ]}
        />
      </GuideSection>

      <GuideSection id="xd-sl" eyebrow="The SRH" title="Segments Left, step by step" tone="mpls">
        <DiagramFrame caption="Each endpoint decrements Segments Left and copies the next SID into the DA.">
          <SlTimelineDiagram />
        </DiagramFrame>
        <p>With three SIDs [R5, R3, R6] (reduced encapsulation) R1 sends DA = R5&apos;s SID and SRH [0: R6, 1: R3], Segments Left 2. R5: SL 2 → 1, DA = R3. R6, on the way, is transit. R3: SL 1 → 0, DA = R6, PSP removes the SRH. R6: USD.</p>
      </GuideSection>

      <GuideSection id="xd-encap" eyebrow="The SRH" title="Headend encapsulation modes" tone="cyan">
        <FieldTable
          title="Headend behaviors (RFC 8986)"
          accent="cyan"
          columns={["Behavior", "What it builds"]}
          rows={[
            ["H.Encaps", "outer IPv6 header + SRH with every SID"],
            ["H.Encaps.Red", "same, but the first SID only in the DA (no SRH for one SID) — IOS XR default"],
            ["H.Insert / H.Insert.Red", "SRH inserted into the original IPv6 packet (no new header) — rarely used"],
          ]}
        />
        <p>The outer source address must be a stable address of the headend — on IOS XR, <Mono>encapsulation source-address</Mono>. Without it the headend cannot encapsulate.</p>
      </GuideSection>

      <GuideSection id="xd-end" eyebrow="Behaviors" title="End and End.X" tone="success">
        <CompareCards
          items={[
            { title: "End", tone: "success", tag: "next segment", points: ["SL−1, DA = next SID", "forward by routing on the new DA"] },
            { title: "End.X", tone: "violet", tag: "next segment, via a link", points: ["SL−1, DA = next SID", "send out a specific adjacency"] },
          ]}
        />
        <p>End.X forces the exit link, like an Adjacency SID in SR-MPLS. R4&apos;s End.X toward R5 (<Mono>2001:db8:100:4:41::</Mono>) followed by R6&apos;s End:</p>
        <SxResult s={ENDX} title="The lab: [R4 End.X → R5, R6 End]" />
        <SxHeaders s={ENDX} />
      </GuideSection>

      <GuideSection id="xd-flavors" eyebrow="Behaviors" title="PSP, USP and USD" tone="warning">
        <FieldTable
          title="End flavors"
          accent="warning"
          columns={["Flavor", "Where", "Effect"]}
          rows={[
            ["PSP — penultimate segment pop", "the endpoint that brings SL to 0", "removes the SRH; the last endpoint gets a plain packet"],
            ["USP — ultimate segment pop", "the last endpoint", "removes the SRH there instead"],
            ["USD — ultimate segment decapsulation", "the last endpoint", "removes the outer header and forwards the inner packet"],
          ]}
        />
        <p>IOS XR allocates End and End.X with PSP and USD: the SRH disappears one hop early, the outer header at the end.</p>
      </GuideSection>

      <GuideSection id="xd-services" eyebrow="Behaviors" title="What comes next: service SIDs" tone="violet">
        <FieldTable
          title="Behaviors of later lessons"
          accent="violet"
          columns={["Behavior", "Meaning"]}
          rows={[
            ["End.DT4 / End.DT6 / End.DT46", "decapsulate and look up the inner packet in a VRF (L3VPN)"],
            ["End.DX4 / End.DX6 / End.DX2", "decapsulate and send to a specific CE / attachment circuit"],
            ["End.B6.Encaps", "binding SID: apply an SR policy"],
            ["uN / uA (uSID)", "compressed SIDs: several instructions in one address"],
          ]}
        />
      </GuideSection>

      <GuideSection id="xd-mtu" eyebrow="Operations" title="MTU, hop limit and ICMPv6" tone="danger">
        <p>Encapsulation adds 40 bytes, the SRH 8 + 16 per entry. Cores need jumbo MTUs; one link at the default 1514 (1500 for IPv6) and big packets are dropped with ICMPv6 <b className="text-pv-text">Packet Too Big</b>. The outer header has its own hop limit, decremented by every router. When the DA is inside a node&apos;s locator but matches no SID, the node drops the packet and may answer ICMPv6 <b className="text-pv-text">destination unreachable</b>.</p>
        <SxResult s={T.mtu} title="The lab: 1460 bytes, two SIDs, R4 at mtu 1514" />
        <CliPanel run={sxOnly(T.mtu, "R4", "show ipv6 interface Gi0/0/0/1", /is Up|MTU/)} caption="IOS XR · R4 — 1500 bytes for IPv6 on the link to R5" />
      </GuideSection>

      <GuideSection id="xd-config" eyebrow="Operations" title="Configuring it on IOS XR" tone="mpls">
        <CliPanel run={sxBlock(X0, "R1", "show running-config", /^segment-routing/, /^end/)} caption="IOS XR · R1 — the locator and the encapsulation source" />
        <CliPanel run={sxBlock(X0, "R1", "show running-config", /^router isis/, /^ interface Loopback0/)} caption="IOS XR · R1 — the locator enabled in IS-IS" />
        <CliPanel run={sxBlock(X0, "R1", "show running-config", /^interface GigabitEthernet0\/0\/0\/1/, /^!/)} caption="IOS XR · R1 — a core interface with mtu 9216" />
        <FieldTable
          title="The statements"
          accent="mpls"
          columns={["Statement", "Where", "Effect"]}
          rows={[
            [<Mono key="1">segment-routing srv6 locators locator MAIN prefix 2001:db8:100:1::/64</Mono>, "global", "define the locator"],
            [<Mono key="2">segment-routing srv6 encapsulation source-address 2001:db8::1</Mono>, "global (headend)", "source of the outer header"],
            [<Mono key="3">router isis CORE address-family ipv6 unicast segment-routing srv6 locator MAIN</Mono>, "IS-IS", "advertise it, allocate End / End.X"],
            [<Mono key="4">mtu 9216</Mono>, "core interfaces", "headroom for the encapsulation"],
          ]}
        />
      </GuideSection>

      <GuideSection id="xd-verify" eyebrow="Operations" title="How to verify" tone="success">
        <FieldTable
          title="Verification on IOS XR"
          accent="success"
          columns={["Question", "Command"]}
          rows={[
            ["Locators", <Mono key="1">show segment-routing srv6 locator</Mono>],
            ["Local SIDs", <Mono key="2">show segment-routing srv6 sid</Mono>],
            ["Encapsulation source", <Mono key="3">show segment-routing srv6 manager</Mono>],
            ["Locators in IS-IS", <Mono key="4">show isis segment-routing srv6 locators · show isis database verbose</Mono>],
            ["Reachability of a SID", <Mono key="5">show route ipv6 &lt;sid&gt; · show cef ipv6 &lt;sid&gt; · ping &lt;sid&gt;</Mono>],
            ["MTU", <Mono key="6">show ipv6 interface &lt;if&gt;</Mono>],
          ]}
        />
        <CliPanel run={sxCli(X0, "R1", "ping 2001:db8:100:5:1::")} caption="IOS XR · R1 — an instantiated End SID answers a ping" />
      </GuideSection>

      <GuideSection id="xd-signatures" eyebrow="Troubleshooting" title="Failure signatures" tone="danger">
        <FailureSignatures
          items={[
            { tag: "SID", title: "Routed, no SID", tone: "danger", points: ["dropped at the owner", "ping to the SID: U"] },
            { tag: "PFX", title: "Wrong locator", tone: "danger", points: ["no route at the headend"] },
            { tag: "ISIS", title: "Locator not in IS-IS", tone: "warning", points: ["locator Up locally, no SIDs", "no route anywhere"] },
            { tag: "ENC", title: "No encapsulation source", tone: "violet", points: ["nothing leaves the headend"] },
            { tag: "MTU", title: "No headroom", tone: "warning", points: ["Packet Too Big", "only big packets"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="xd-ladder" eyebrow="Troubleshooting" title="The troubleshooting ladder" tone="danger">
        <TroubleshootingFlow
          steps={[
            { question: "Does plain IPv6 between the same hosts work?", look: "If not, it isn't SRv6 yet." },
            { question: "Does the headend encapsulate?", look: "show segment-routing srv6 manager." },
            { question: "Is every locator advertised with its documented prefix?", look: "show isis segment-routing srv6 locators on each owner." },
            { question: "Does every SID exist on its owner?", look: "show segment-routing srv6 sid; ping the SID." },
            { question: "Where did the packet die, and with which DA?", look: "Follow the headers." },
            { question: "Is there MTU headroom?", look: "show ipv6 interface on the path." },
          ]}
        />
      </GuideSection>

      <GuideSection id="xd-tickets" eyebrow="Troubleshooting" title="Five faults, evidence to proof" tone="danger">
        <FailureWalk title="1 · Routed to R3, dropped by R3" normal="R3's locator is enabled in IS-IS; its End SID exists." change="The locator left IS-IS in a migration; Loopback1 still advertises the /64." evidence={<CliPanel run={sxCli(T.nosid, "R1", "ping 2001:db8:100:3:1::")} caption="IOS XR · R1 — the SID doesn't answer" />} next="The route says “R3”; R3's local SID table is empty." fix={<Mono>R3: router isis CORE → address-family ipv6 unicast → segment-routing srv6 → locator MAIN; remove Loopback1 → commit</Mono>} proof="R3's End SID is back; [R3 End, R6 End] reaches H6." />
        <FailureWalk title="2 · R5's SID has no route" normal="R5's locator is 2001:db8:100:5::/64." change="The template set 2001:db8:100:50::/64." evidence={<CliPanel run={sxCli(T.locator, "R5", "show segment-routing srv6 locator")} caption="IOS XR · R5 — the locator prefix is …:50::/64" />} next="R5's End SID became 2001:db8:100:50:1::; nobody routes …:5::/64." fix={<Mono>R5: segment-routing srv6 locators locator MAIN → prefix 2001:db8:100:5::/64 → commit</Mono>} proof="R5's End SID is …:5:1:: again; [R5 End, R6 End] reaches H6." />
        <FailureWalk title="3 · Locator Up, but nowhere to be seen" normal="R6 advertises its locator in IS-IS." change="segment-routing srv6 locator MAIN is missing under IS-IS on R6." evidence={<CliPanel run={sxCli(T.notisis, "R1", "show route ipv6 2001:db8:100:6:1::")} caption="IOS XR · R1 — no route for R6's SID" />} next="Configured but not advertised: no route, and no End SID allocated." fix={<Mono>R6: router isis CORE → address-family ipv6 unicast → segment-routing srv6 → locator MAIN → commit</Mono>} proof="R1 routes …:6::/64 to R4; [R6 End] reaches H6." />
        <FailureWalk title="4 · Nothing leaves R1" normal="R1 encapsulates with source 2001:db8::1." change="encapsulation source-address was lost in a rewrite." evidence={<CliPanel run={sxOnly(T.encap, "R1", "show segment-routing srv6 manager", /Encapsulation|Source|Configured/)} caption="IOS XR · R1 — no source address" />} next="No outer source, no encapsulation." fix={<Mono>R1: segment-routing srv6 encapsulation → source-address 2001:db8::1 → commit</Mono>} proof="A test via [R6 End] reaches H6." />
        <FailureWalk title="5 · Only big packets vanish" normal="Core interfaces run mtu 9216." change="R4's interface toward R5 is back at 1514." evidence={<SxResult s={T.mtu} title="The lab: 1460 bytes via [R5 End, R6 End]" />} next="1524 bytes on the wire, 1500 allowed." fix={<Mono>R4: interface Gi0/0/0/1 → mtu 9216 → commit</Mono>} proof="The 1460-byte test reaches H6." />
      </GuideSection>

      <GuideSection id="xd-myths" eyebrow="Master it" title="Common misconceptions" tone="warning">
        <Misconceptions
          items={[
            { myth: "SRv6 is MPLS labels written as IPv6 addresses.", correction: "Transit is plain IPv6 routing; only endpoints execute SIDs, by their local SID table." },
            { myth: "Every router must support SRv6.", correction: "Only endpoints and headends; transit needs IPv6." },
            { myth: "A routable locator means the SID works.", correction: "Only an instantiated local SID executes." },
            { myth: "Segments Left counts hops.", correction: "It counts segments still to execute." },
            { myth: "Segment List[0] is the first segment.", correction: "It is the last; the list is reversed." },
            { myth: "The SRH is always present.", correction: "With reduced encapsulation, one SID needs none." },
          ]}
        />
      </GuideSection>

      <GuideSection id="xd-quiz" eyebrow="Master it" title="Knowledge check" tone="cyan">
        <KnowledgeQuiz questions={QUIZ} />
      </GuideSection>

      <GuideSection id="xd-explain" eyebrow="Master it" title="Can you explain it?" tone="violet">
        <ExplainIt
          items={[
            { q: "Why can R2 forward SRv6 traffic without SRv6?", a: "It forwards on the DA by longest match; the DA is a SID inside R3's locator, which it has an IPv6 route for." },
            { q: "What exactly does R3 do with [R3, R6]?", a: "End: SL 1 → 0, DA = R6's SID, PSP removes the SRH, forward." },
            { q: "Why does [R5, R3, R6] cross R6 twice?", a: "After R5 the DA is R3's SID, and R5's best route to R3's locator goes via R6, which forwards it as transit." },
            { q: "Why could you ping 2001:db8:100:3::1 but not R3's SID?", a: "The first was a plain Loopback1 address; the SID wasn't in R3's local SID table." },
            { q: "Why do SRv6 cores need jumbo MTUs?", a: "Encapsulation adds 40 bytes plus 8 + 16 per SRH entry to every packet." },
          ]}
        />
      </GuideSection>

      <GuideSection id="xd-glossary" eyebrow="Master it" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "SRv6", def: "Segment routing over the IPv6 data plane." },
            { term: "SID block", def: "The prefix all locators are allocated from." },
            { term: "Network program", def: "A segment list seen as an ordered list of instructions (RFC 8986)." },
            { term: "End / End.X", def: "Endpoint behaviors: next segment; next segment via a link." },
            { term: "PSP / USP / USD", def: "Flavors: pop the SRH early / at the end; decapsulate at the end." },
            { term: "H.Encaps(.Red)", def: "Headend encapsulation (reduced: first SID only in the DA)." },
            { term: "Locator TLV", def: "IS-IS TLV 27 carrying the locator and End SIDs." },
          ]}
        />
      </GuideSection>

      <GuideSection id="xd-mental" eyebrow="Master it" title="Mental model" tone="violet">
        <p>The locator gets you to the building; the function tells the concierge what to do; the SRH is the sealed itinerary read backwards; the DA is the next address written on the envelope; transit drivers only read the envelope.</p>
      </GuideSection>

      <GuideSection id="xd-practice" eyebrow="Master it" title="Practice in the SRv6 Foundations Lab" tone="violet">
        <p>Six Learn levels, then the workspace: locators and SIDs on every router, an IOS XR console, plain and SRv6 test traffic with packet sizes and the headers hop by hop, five challenges and the five tickets above.</p>
        <LabBridge />
        <PresentationBridge>Rewatch the SRv6 Foundations presentation.</PresentationBridge>
      </GuideSection>
    </div>
  );
}
