import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const SRV6F_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "fd-arch", label: "SRv6 network programming" },
  { id: "fd-roles", label: "Headend, endpoint, transit" },
  { id: "fd-sid", label: "SID structure and allocation" },
  { id: "fd-igp", label: "Advertising locators" },
  { id: "fd-srh", label: "The SRH, field by field" },
  { id: "fd-sl", label: "Segments Left processing" },
  { id: "fd-behaviors", label: "Behavior catalog" },
  { id: "fd-encaps", label: "Headend modes and SRH options" },
  { id: "fd-security", label: "The SR domain boundary" },
  { id: "fd-compare", label: "SRv6 vs SR-MPLS" },
  { id: "fd-trouble", label: "Troubleshooting" },
  { id: "fd-verify", label: "Verification" },
  { id: "fd-glossary", label: "Glossary" },
  { id: "fd-mental", label: "Mental model" },
];

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

export function Srv6FoundationsDeepDiveContent() {
  return (
    <>
      <GuideSection id="fd-arch" eyebrow="Architecture" title="SRv6 network programming" tone="ip">
        <DiagramFrame caption="RFC 8986: SIDs are instructions; the locator says where, the function says what.">
          <ProgrammingDiagram />
        </DiagramFrame>
        <p>
          Segment Routing (RFC 8402) steers a packet through an ordered list of segments. SRv6 instantiates each segment as an IPv6 SID and carries the list in the Segment Routing Header (RFC 8754). RFC 8986 defines the behaviors a SID can be bound to.
        </p>
      </GuideSection>

      <GuideSection id="fd-roles" eyebrow="Architecture" title="Headend, endpoint, transit" tone="cyan">
        <DiagramFrame caption="Three roles; one router can play different roles for different packets.">
          <RolesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="fd-sid" eyebrow="Concepts" title="SID structure and allocation" tone="violet">
        <DiagramFrame caption="Lengths are an operator choice inside the 128 bits.">
          <SidStructureDiagram />
        </DiagramFrame>
        <p>
          Operators pick a SID block for the domain and a locator per node, then allocate functions from it. An address becomes a SID only when a node instantiates it with a behavior. Arguments are used by a few behaviors only. Compressed SID formats (micro-SIDs) pack several instructions into one address; they are a separate topic.
        </p>
      </GuideSection>

      <GuideSection id="fd-igp" eyebrow="Control plane" title="Advertising locators" tone="ospf">
        <p>
          Nodes advertise their locators in the IGP — IS-IS (RFC 9352) or OSPFv3 (RFC 9513) SRv6 extensions — along with SRv6 capabilities. Other routers only need the locator prefix in their FIB; individual SIDs stay local. That is why transit routers do not need to be SRv6-aware to forward SRv6 traffic, provided they forward IPv6 and pass the SRH through.
        </p>
      </GuideSection>

      <GuideSection id="fd-srh" eyebrow="Data plane" title="The SRH, field by field" tone="violet">
        <DiagramFrame caption="An IPv6 Routing header of type 4.">
          <SrhLayoutDiagram />
        </DiagramFrame>
        <FieldTable
          title="Invariants"
          accent="violet"
          columns={["Rule", "Why it matters"]}
          rows={[
            [<Mono key="a">DA = Segment List[SL]</Mono>, "The DA always holds the active segment"],
            [<Mono key="b">LE = n − 1</Mono>, "Index of the last stored element"],
            ["Reverse storage", "[0] is the final segment, the highest index is the first"],
            ["Single segment", "The DA alone can carry it — no SRH is required"],
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-sl" eyebrow="Data plane" title="Segments Left processing" tone="warning">
        <DiagramFrame caption="Generic three-segment program ⟨S1, S2, S3⟩.">
          <SlTimelineDiagram />
        </DiagramFrame>
        <p>
          End with <Mono>SL &gt; 0</Mono>: decrement SL, copy <Mono>Segment List[SL]</Mono> into the DA, then forward by FIB lookup on the new DA. End with <Mono>SL = 0</Mono>: the program is finished; the node processes the next header.
        </p>
      </GuideSection>

      <GuideSection id="fd-behaviors" eyebrow="Concepts" title="Behavior catalog" tone="violet">
        <FieldTable
          title="RFC 8986 families (overview)"
          accent="violet"
          columns={["Behavior", "In one line"]}
          rows={[
            [<Mono key="1">End</Mono>, "Advance to the next segment, forward by FIB"],
            [<Mono key="2">End.X</Mono>, "Advance, then use a specific L3 adjacency"],
            [<Mono key="3">End.T</Mono>, "Advance, then look up in a specific table"],
            [<Mono key="4">End.DX4/6, End.DT4/6/46, End.DX2</Mono>, "Final segment: decapsulate and cross-connect or table-lookup"],
            [<Mono key="5">End.B6.Encaps</Mono>, "Bind to an SR Policy and encapsulate again"],
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-encaps" eyebrow="Data plane" title="Headend modes and SRH options" tone="ip">
        <CompareCards
          items={[
            { title: "H.Encaps", tone: "ip", tag: "full SRH", points: ["New outer IPv6 header + SRH", "Original packet kept intact inside", "Every SID stored in the SRH"] },
            { title: "H.Encaps.Red", tone: "violet", tag: "reduced", points: ["First SID only in the DA", "SRH omits it (smaller header)", "No SRH at all for one SID"] },
          ]}
        />
        <p>
          Flavors such as PSP, USP and USD change when the SRH or the outer header is removed. This lesson has no headend encapsulation at all: R1 simply originates the packet with the program.
        </p>
      </GuideSection>

      <GuideSection id="fd-security" eyebrow="Operations" title="The SR domain boundary" tone="danger">
        <Callout tone="danger" title="Trust model" icon="!">
          SRv6 assumes a trusted SR domain. Edge routers filter packets from outside that target internal SIDs or carry an SRH, and the SRH can carry an HMAC TLV. Without that boundary, anyone who can reach a SID can program your network.
        </Callout>
      </GuideSection>

      <GuideSection id="fd-compare" eyebrow="Model" title="SRv6 vs SR-MPLS" tone="mpls">
        <FieldTable
          title="Same architecture, different data plane"
          accent="mpls"
          columns={["", "SR-MPLS", "SRv6"]}
          rows={[
            ["SID", "20-bit label (from SRGB/SRLB)", "128-bit IPv6 address"],
            ["Active segment", "Top label", "IPv6 Destination Address"],
            ["Program", "Label stack", "SRH (only when needed)"],
            ["Operations", "PUSH / SWAP / POP, PHP", "FIB forward, local SID match, End"],
            ["Transit requirement", "MPLS forwarding", "Plain IPv6 forwarding"],
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Work bottom up"
          mark="→"
          items={[
            "IPv6 underlay: adjacencies up, locator prefixes in every FIB.",
            "Reachability to the SID's owner along the expected path.",
            "Owner's Local SID Table: is the exact SID instantiated, with the right behavior?",
            "Packet state at the owner: DA, SL, LE and Segment List consistent?",
            "Transit filtering: are routers or firewalls dropping packets with an SRH?",
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard
          tone="success"
          title="What to check (vendor-neutral)"
          mark="✓"
          items={["The IGP database shows each node's locator.", "The FIB holds one route per locator, not per SID.", "Each owner's Local SID Table lists its SIDs and behaviors.", "A capture at each hop shows DA and SL changing only at owners.", "A real end-to-end packet, not just table state."]}
        />
      </GuideSection>

      <GuideSection id="fd-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "SR domain", def: "The trusted set of nodes that participate in SRv6 and filter at the edge." },
            { term: "SID block", def: "Prefix from which a domain's locators are allocated." },
            { term: "Locator", def: "Routable prefix of one node's SIDs (block + node)." },
            { term: "Endpoint behavior", def: "What an owner does when its SID is the DA (RFC 8986)." },
            { term: "SRH", def: "Routing header type 4 (RFC 8754) holding the Segment List." },
            { term: "H.Encaps", def: "Headend behavior: push an outer IPv6 header and SRH." },
            { term: "Reduced SRH", def: "SRH that omits the first SID because the DA already carries it." },
            { term: "PSP / USP / USD", def: "Flavors that change when the SRH or outer header is removed." },
          ]}
        />
      </GuideSection>

      <GuideSection id="fd-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          SRv6 is segment routing written as IPv6 addresses: route to the locator, let the owner run its SID&apos;s behavior, and let the Destination Address always name the instruction that runs next.
        </Callout>
      </GuideSection>
    </>
  );
}
