import { Callout, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, DPill, DRegion, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ALL_ISS, LSP_LIFETIME } from "@/lib/sim-engine/scenarios/isisFundamentals";
import { IsisChain } from "./guideSvg";

export const ISIS_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "isd-integrated", label: "Integrated IS-IS" },
  { id: "isd-nsap", label: "NSAP and NET" },
  { id: "isd-levels", label: "Levels and areas" },
  { id: "isd-leak", label: "Route leaking" },
  { id: "isd-dis", label: "Broadcast, DIS, pseudonode" },
  { id: "isd-pdus", label: "PDU types" },
  { id: "isd-lsp", label: "LSP lifecycle" },
  { id: "isd-tlv", label: "TLVs and wide metrics" },
  { id: "isd-ecmp", label: "ECMP and overload" },
  { id: "isd-auth", label: "IPv6 and authentication" },
  { id: "isd-ops", label: "Troubleshooting ladder" },
  { id: "isd-model", label: "Mental model" },
  { id: "isd-glossary", label: "Glossary" },
];

function IntegratedDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={170} label="Integrated IS-IS: a CLNS protocol, discriminator 0x83, carrying IPv4 and IPv6 reachability in TLVs">
      <DFieldRow x={40} y={14} fields={[f("Data link", "802.3 / PPP / HDLC", 150, D.eth), f("LLC / NLPID", "FE FE 03 · 0x83", 150, D.violet, true), f("IS-IS PDU", "hello · LSP · SNP", 140, D.cyan), f("TLVs", "IPv4 · IPv6 · …", 120, D.warning, true)]} />
      <text x={320} y={92} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        ISO 10589 defined IS-IS for CLNP; RFC 1195 added IP (Integrated / Dual IS-IS)
      </text>
      <text x={320} y={112} textAnchor="middle" fill={D.muted} fontSize={10}>
        IP is just another set of TLVs — adding IPv6 (RFC 5308) or segment routing needs no new transport.
      </text>
      <text x={320} y={132} textAnchor="middle" fill={D.muted} fontSize={10}>
        Not reachable by IP → hard to attack from outside, and runs before any IP route exists.
      </text>
    </DiagramSvg>
  );
}

function NsapDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={170} label="NSAP structure: AFI, area, System ID, NSEL; the NET is the NSAP with NSEL 00">
      <DFieldRow x={40} y={14} fields={[f("AFI", "49 (private)", 90, D.violet), f("Rest of Area ID", "0001 (1–12 bytes)", 170, D.violet), f("System ID", "6 bytes", 190, D.cyan, true), f("NSEL", "1 byte", 110, D.faint)]} />
      <text x={40} y={84} fill={D.violet} fontSize={10}>
        ◄──── Area address (variable) ────►
      </text>
      <text x={320} y={112} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        NET = NSAP with NSEL 00 · 49.0001.0000.0000.0001.00
      </text>
      <text x={320} y={132} textAnchor="middle" fill={D.muted} fontSize={10}>
        Common practice: derive the System ID from the loopback, e.g. 10.0.0.1 → 0100.0000.0001 (010.000.000.001).
      </text>
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        Up to three area addresses per router during renumbering / area merge.
      </text>
    </DiagramSvg>
  );
}

function LevelsDiagram() {
  return (
    <DiagramSvg h={230} label="Level-1 areas connect through Level-1-2 routers to the Level-2 backbone; L1 routers use the ATT bit for a default route">
      <DRegion x={20} y={24} w={190} h={150} label="Area 49.0001 (L1)" color={D.success} />
      <DRegion x={430} y={24} w={190} h={150} label="Area 49.0002 (L1)" color={D.success} />
      <DRegion x={150} y={58} w={340} h={84} label="Level-2 backbone (contiguous L2 chain)" color={D.violet} />
      <DNode x={80} y={140} label="R1" sub="L1 only" accent={D.success} w={86} />
      <DNode x={200} y={112} label="R2" sub="L1/L2 · ATT" accent={D.violet} w={86} />
      <DNode x={440} y={112} label="R3" sub="L1/L2 · ATT" accent={D.violet} w={86} />
      <DNode x={560} y={140} label="R4" sub="L1 only" accent={D.success} w={86} />
      <DLink x1={123} y1={140} x2={157} y2={122} color={D.success} />
      <DLink x1={243} y1={112} x2={397} y2={112} color={D.violet} label="L2 adjacency" />
      <DLink x1={483} y1={122} x2={517} y2={140} color={D.success} />
      <text x={320} y={200} textAnchor="middle" fill={D.muted} fontSize={10}>
        Area borders sit on links, not inside routers. L1 = intra-area; L2 = inter-area backbone.
      </text>
      <text x={320} y={218} textAnchor="middle" fill={D.muted} fontSize={10}>
        L1-only routers follow the ATT (attached) bit set by L1/L2 routers → default route to nearest L1/L2.
      </text>
    </DiagramSvg>
  );
}

function LeakDiagram() {
  return (
    <DiagramSvg h={170} label="Route leaking: L1 routes are advertised up to L2 by default; L2 routes leak down into L1 only by policy, with the up/down bit set">
      <DNode x={120} y={50} label="Level-2" sub="all areas' prefixes" accent={D.violet} w={150} />
      <DNode x={120} y={130} label="Level-1 area" sub="own prefixes + default" accent={D.success} w={150} />
      <DArrow x1={90} y1={108} x2={90} y2={74} color={D.success} />
      <DArrow x1={150} y1={74} x2={150} y2={108} color={D.warning} dashed />
      <text x={220} y={80} fill={D.success} fontSize={10}>
        ↑ L1 → L2: automatic on L1/L2 routers
      </text>
      <text x={220} y={100} fill={D.warning} fontSize={10}>
        ↓ L2 → L1: only with a leaking policy (RFC 5302)
      </text>
      <text x={220} y={120} fill={D.muted} fontSize={10}>
        Leaked prefixes carry the up/down bit — never re-advertised to L2 (loop prevention)
      </text>
      <text x={220} y={140} fill={D.muted} fontSize={10}>
        Why leak? Optimal exit and specific loopbacks (e.g. BGP next hops, LDP FECs)
      </text>
    </DiagramSvg>
  );
}

function DisDiagram() {
  return (
    <DiagramSvg h={220} label="Broadcast LAN: routers elect a DIS which creates a pseudonode; point-to-point has no DIS">
      <text x={160} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        Broadcast circuit
      </text>
      <DNode x={160} y={70} label="Pseudonode" sub="LAN LSP · ID .01" accent={D.warning} w={120} />
      <DNode x={60} y={150} label="R1" sub="prio 64" accent={D.cyan} w={72} />
      <DNode x={160} y={150} label="R2 · DIS" sub="prio 100" accent={D.warning} w={80} />
      <DNode x={260} y={150} label="R3" sub="prio 64" accent={D.cyan} w={72} />
      <DLink x1={60} y1={128} x2={130} y2={92} />
      <DLink x1={160} y1={128} x2={160} y2={92} />
      <DLink x1={260} y1={128} x2={190} y2={92} />
      <text x={165} y={194} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Highest priority, then highest MAC wins
      </text>
      <text x={165} y={210} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        preemptive · no backup DIS · CSNP every 10 s
      </text>
      <line x1={330} y1={20} x2={330} y2={190} stroke={D.line} strokeDasharray="3 4" />
      <text x={480} y={18} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        Point-to-point circuit (this lesson)
      </text>
      <DNode x={410} y={100} label="P1" accent={D.cyan} w={72} />
      <DNode x={560} y={100} label="P2" accent={D.cyan} w={72} />
      <DLink x1={446} y1={100} x2={524} y2={100} color={D.success} label="P2P IIH (17)" />
      <text x={480} y={160} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        No DIS, no pseudonode, three-way handshake,
      </text>
      <text x={480} y={176} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        PSNP acks — the norm for two-router Ethernet links
      </text>
    </DiagramSvg>
  );
}

function PduDiagram() {
  return (
    <DiagramSvg h={250} label="IS-IS PDU types 15, 16, 17, 18, 20, 24, 25, 26 and 27">
      <DTable
        x={60}
        y={8}
        title="IS-IS PDU types"
        cols={[
          { label: "TYPE", w: 70 },
          { label: "PDU", w: 200 },
          { label: "PURPOSE", w: 250 },
        ]}
        rows={[
          ["15", "L1 LAN IIH", "Hello on broadcast circuits, Level 1"],
          ["16", "L2 LAN IIH", "Hello on broadcast circuits, Level 2"],
          ["17", "P2P IIH", "Hello on point-to-point, both levels"],
          ["18", "L1 LSP", "Level-1 link state"],
          ["20", "L2 LSP", "Level-2 link state"],
          ["24", "L1 CSNP", "Level-1 complete database summary"],
          ["25", "L2 CSNP", "Level-2 complete database summary"],
          ["26", "L1 PSNP", "Level-1 ack / request"],
          ["27", "L2 PSNP", "Level-2 ack / request"],
        ]}
        highlight={{ row: 2, color: D.success }}
      />
    </DiagramSvg>
  );
}

function LifecycleDiagram() {
  return (
    <DiagramSvg h={214} label="LSP lifecycle: originate with sequence and lifetime counting down, refresh with a higher sequence, purge at zero lifetime; higher sequence is newer, at the same sequence a purge beats a non-zero lifetime">
      <DPill x={90} y={40} text="originate seq n" color={D.success} w={140} />
      <DPill x={260} y={40} text={`lifetime ${LSP_LIFETIME} ↓`} color={D.cyan} w={130} />
      <DPill x={420} y={40} text="refresh seq n+1" color={D.warning} w={140} />
      <DPill x={570} y={40} text="purge (lifetime 0)" color={D.danger} w={130} />
      <DArrow x1={162} y1={40} x2={193} y2={40} color={D.muted} width={1.5} />
      <DArrow x1={327} y1={40} x2={348} y2={40} color={D.muted} width={1.5} />
      <DArrow x1={492} y1={40} x2={503} y2={40} color={D.muted} width={1.5} />
      <text x={320} y={84} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        Higher sequence = newer · same sequence: purge (lifetime 0) beats non-zero · otherwise same version
      </text>
      <text x={320} y={102} textAnchor="middle" fill={D.text} fontSize={10}>
        Same sequence, both lifetimes non-zero → the same version, even if the lifetime values differ.
      </text>
      <text x={320} y={120} textAnchor="middle" fill={D.warning} fontSize={10}>
        Same sequence, different checksum → inconsistent/corrupt copy (error handling), not an age tie-break.
      </text>
      <text x={320} y={142} textAnchor="middle" fill={D.muted} fontSize={10}>
        Refresh before expiry (default refresh ≈ 900 s for a 1200 s lifetime); any change also bumps the sequence.
      </text>
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        Remaining Lifetime counts down in every copy; it is outside the checksum, so aging needs no recomputation.
      </text>
      <text x={320} y={178} textAnchor="middle" fill={D.muted} fontSize={10}>
        Stale own LSP after reboot? Re-originate above the stored sequence. Sequence wrap → stop for MaxAge + ZeroAge.
      </text>
      <text x={320} y={196} textAnchor="middle" fill={D.muted} fontSize={10}>
        Fragments: one router may own LSP IDs …-00 to …-FF when TLVs outgrow a PDU.
      </text>
    </DiagramSvg>
  );
}

function TlvDiagram() {
  return (
    <DiagramSvg h={230} label="Common TLVs 1, 22, 128/130 vs 135, 129, 132, 137, 232, 236 and 240; narrow metrics max 63, wide metrics 24 and 32 bit">
      <DTable
        x={30}
        y={8}
        title="Common TLVs"
        cols={[
          { label: "TLV", w: 70 },
          { label: "NAME", w: 220 },
          { label: "NOTE", w: 290 },
        ]}
        rows={[
          ["1", "Area Addresses", "must share one at L1"],
          ["2 / 22", "IS Reachability (narrow / extended)", "22: 24-bit metric + sub-TLVs (TE)"],
          ["128 / 135", "IP Reachability (narrow / extended)", "135: 32-bit metric, up/down bit"],
          ["129 · 132", "Protocols Supported · IP Interface", "0xCC = IPv4, 0x8E = IPv6"],
          ["137", "Dynamic Hostname", "\"PE2\" in show output instead of 0000.0000.0004"],
          ["232 / 236", "IPv6 Interface / IPv6 Reachability", "RFC 5308"],
          ["240", "P2P Three-Way Adjacency", "RFC 5303"],
        ]}
      />
      <text x={320} y={210} textAnchor="middle" fill={D.warning} fontSize={10}>
        Narrow metrics: 6 bits (max 63 per link). Wide metrics (metric-style wide) are needed for TE and large cores.
      </text>
    </DiagramSvg>
  );
}

function EcmpDiagram() {
  return (
    <DiagramSvg h={210} label="ECMP: two equal-cost paths are both installed; overload bit makes other routers avoid transiting a router">
      <DNode x={50} y={90} label="PE1" accent={D.violet} w={70} />
      <DNode x={200} y={40} label="P1" accent={D.cyan} w={70} />
      <DNode x={200} y={140} label="P3" sub="OL bit" accent={D.danger} w={70} />
      <DNode x={350} y={90} label="PE2" accent={D.violet} w={70} />
      <DArrow x1={85} y1={80} x2={165} y2={48} color={D.success} label="10" />
      <DArrow x1={235} y1={48} x2={315} y2={80} color={D.success} label="10" />
      <DLink x1={85} y1={100} x2={165} y2={132} color={D.line} dashed label="10" labelDy={16} />
      <DLink x1={235} y1={132} x2={315} y2={100} color={D.line} dashed label="10" labelDy={16} />
      <text x={410} y={34} fill={D.text} fontSize={10} fontWeight={700}>
        Without OL: two equal paths (20)
      </text>
      <text x={410} y={50} fill={D.muted} fontSize={9.5}>
        → both installed (ECMP),
      </text>
      <text x={410} y={64} fill={D.muted} fontSize={9.5}>
        flows hashed across them
      </text>
      <text x={410} y={130} fill={D.danger} fontSize={10} fontWeight={700}>
        P3 sets overload bit
      </text>
      <text x={410} y={146} fill={D.muted} fontSize={9.5}>
        → not used for transit;
      </text>
      <text x={410} y={160} fill={D.muted} fontSize={9.5}>
        its own prefixes still reachable
      </text>
      <text x={320} y={196} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Use OL during maintenance or on-startup until BGP converges (set-overload-bit on-startup wait-for-bgp).
      </text>
    </DiagramSvg>
  );
}

function LadderDiagram() {
  return (
    <DiagramSvg h={120} label="Troubleshooting ladder along the chain: physical, circuit level, adjacency, LSDB, SPF, forwarding">
      <IsisChain y={50} segs={{ a: "both", b: "down", c: "both" }} colors={{ a: D.success, c: D.success }} labels={{ b: "where is it broken?" }} />
      <text x={320} y={108} textAnchor="middle" fill={D.muted} fontSize={10}>
        link → circuit level / area / auth / MTU → adjacency → LSDB → SPF → RIB/FIB → forwarding
      </text>
    </DiagramSvg>
  );
}

export function IsisDeepDiveContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="isd-integrated" eyebrow="Origins" title="Integrated IS-IS" tone="cyan">
        <DiagramFrame caption="An OSI routing protocol that learned to carry IP.">
          <IntegratedDiagram />
        </DiagramFrame>
        <p>
          Every IS-IS PDU starts with the Intradomain Routing Protocol Discriminator <Mono>0x83</Mono>. On Ethernet it rides 802.3 with LLC <Mono>FE FE 03</Mono>, sent to AllISs <Mono>{ALL_ISS}</Mono> (point-to-point Ethernet circuits) or AllL1ISs 01:80:C2:00:00:14 / AllL2ISs 01:80:C2:00:00:15 on broadcast circuits.
        </p>
      </GuideSection>

      <GuideSection id="isd-nsap" eyebrow="Addressing" title="NSAP and NET" tone="violet">
        <DiagramFrame caption="The area is variable length; System ID and NSEL are fixed.">
          <NsapDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isd-levels" eyebrow="Hierarchy" title="Level 1, Level 2 and Level-1-2" tone="success">
        <DiagramFrame caption="Two levels, one protocol.">
          <LevelsDiagram />
        </DiagramFrame>
        <CompareCards
          items={[
            { title: "Level 1", tone: "success", tag: "intra-area", points: ["Neighbors must share an area address", "LSDB covers one area", "Exits via ATT bit / default route"] },
            { title: "Level 2", tone: "violet", tag: "backbone", points: ["Area address may differ", "Must be contiguous", "Carries all areas' prefixes"] },
            { title: "Level-1-2", tone: "warning", tag: "border", points: ["Two LSDBs, two SPF runs", "Sets ATT in its L1 LSP", "Default on many vendors — often worth disabling"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="isd-leak" eyebrow="Policy" title="Route leaking" tone="warning">
        <DiagramFrame caption="Up is automatic; down is a choice.">
          <LeakDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isd-dis" eyebrow="Circuits" title="Broadcast vs point-to-point" tone="warning">
        <DiagramFrame caption="The DIS represents the LAN as a pseudonode and floods CSNPs periodically.">
          <DisDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Unlike OSPF">
          There is no backup DIS and election is preemptive: a higher-priority router becomes DIS immediately. All routers on the LAN still form adjacencies with each other — only LSP synchronization is anchored on the DIS.
        </Callout>
      </GuideSection>

      <GuideSection id="isd-pdus" eyebrow="PDUs" title="Nine PDU types" tone="cyan">
        <DiagramFrame caption="Hellos, link state, and two sequence-number PDUs — per level.">
          <PduDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isd-lsp" eyebrow="Lifecycle" title="Sequence, lifetime, refresh, purge" tone="warning">
        <DiagramFrame caption="Remaining lifetime counts down (OSPF's age counts up).">
          <LifecycleDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isd-tlv" eyebrow="Extensibility" title="TLVs and wide metrics" tone="violet">
        <DiagramFrame caption="New features are new TLVs — the reason IS-IS ages well.">
          <TlvDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isd-ecmp" eyebrow="Path selection" title="ECMP and the overload bit" tone="ip">
        <DiagramFrame caption="Equal costs share load; overload removes a router from transit.">
          <EcmpDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isd-auth" eyebrow="Extensions" title="IPv6 and authentication" tone="success">
        <FieldTable
          title="Beyond this lesson"
          columns={["Feature", "How"]}
          rows={[
            ["IPv6 single topology", "TLVs 232 / 236 in the same SPF — every link must run both IPv4 and IPv6"],
            ["IPv6 multi-topology", "RFC 5120: TLVs 222 / 235 / 237, separate SPF per topology"],
            ["Authentication", "TLV 10 — HMAC-MD5 (RFC 5304) or HMAC-SHA (RFC 5310); separately for hellos and for LSP/SNP per level"],
            ["Segment Routing", "SR sub-TLVs advertise SIDs, so the IGP distributes labels itself"],
            ["Fast convergence", "BFD, SPF/LSP-generation throttling, LFA / TI-LFA"],
          ]}
        />
      </GuideSection>

      <GuideSection id="isd-ops" eyebrow="Operations" title="Troubleshooting ladder" tone="danger">
        <DiagramFrame caption="Walk up one layer at a time.">
          <LadderDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Link", body: "Cisco-style / Juniper-style: show interfaces — up/up? MTU both sides?", tone: "success" },
            { title: "Circuit", body: "Level, circuit type (P2P vs LAN), area (L1), auth, hello padding vs MTU.", tone: "warning" },
            { title: "Adjacency", body: "Cisco-style show isis neighbors · Juniper-style show isis adjacency — Up / Init / missing; three-way state.", tone: "violet" },
            { title: "LSDB", body: "show isis database (both vendors) — sequence moving? neighbor listed both ways?", tone: "cyan" },
            { title: "SPF / RIB", body: "Cisco-style show ip route isis · Juniper-style show route protocol isis — metric and next hop as designed?", tone: "ip" },
          ]}
        />
      </GuideSection>

      <GuideSection id="isd-model" eyebrow="Mental model" title="Four sentences" tone="cyan">
        <FlowSteps
          steps={[
            { title: "Hellos", body: "decide who is a neighbor, per level, per circuit.", tone: "success" },
            { title: "LSPs", body: "each router describes only itself; flooding copies every description everywhere in the level.", tone: "warning" },
            { title: "SNPs", body: "make sure every copy is the newest one.", tone: "violet" },
            { title: "SPF", body: "turns identical databases into each router's own routes.", tone: "ip" },
          ]}
        />
      </GuideSection>

      <GuideSection id="isd-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "CLNS / CLNP", def: "OSI connectionless network service / protocol that IS-IS was built for." },
            { term: "NSAP", def: "OSI network address; a router's NSAP with NSEL 00 is its NET." },
            { term: "DIS", def: "Designated IS on a broadcast LAN; originates the pseudonode LSP." },
            { term: "ATT bit", def: "Set by an L1/L2 router in its L1 LSP to advertise a path out of the area." },
            { term: "Overload bit", def: "Tells other routers not to use this router for transit." },
            { term: "Up/down bit", def: "Marks a prefix leaked from L2 into L1 so it is not re-advertised upward." },
            { term: "Wide metric", def: "24-bit link / 32-bit prefix metric in TLVs 22 and 135." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
