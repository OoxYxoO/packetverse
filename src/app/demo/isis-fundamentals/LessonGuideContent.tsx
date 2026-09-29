import { Callout, ChecklistCard, DIAGRAM as D, DiagramFrame, DiagramSvg, DPill, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { hex4 } from "@/lib/sim-engine/scenarios/fundamentalsPackets";
import { ALL_ISS, AREA, LINK_METRIC, LSP_LIFETIME, PDU, PREFIX_METRIC, ROUTER, buildLsp, hex8s, lspChecksum, lspLength, netOf, type IsisRouter } from "@/lib/sim-engine/scenarios/isisFundamentals";
import { IsisChain, Lanes } from "./guideSvg";

export const ISIS_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "isl-mission", label: "The mission" },
  { id: "isl-topology", label: "Topology" },
  { id: "isl-net", label: "NET decomposition" },
  { id: "isl-l2", label: "IS-IS over Layer 2" },
  { id: "isl-iih", label: "The P2P IIH" },
  { id: "isl-3way", label: "Three-way handshake" },
  { id: "isl-up", label: "Adjacencies Up" },
  { id: "isl-lsp", label: "LSP anatomy" },
  { id: "isl-flood", label: "Flooding" },
  { id: "isl-sync", label: "CSNP / PSNP" },
  { id: "isl-lsdb", label: "The LSDB" },
  { id: "isl-spf", label: "SPF" },
  { id: "isl-fwd", label: "IPv4 forwarding" },
  { id: "isl-incident", label: "Level mismatch" },
  { id: "isl-repair", label: "Repair" },
  { id: "isl-glossary", label: "Glossary" },
];

const NB: Record<IsisRouter, IsisRouter[]> = { PE1: ["P1"], P1: ["PE1", "P2"], P2: ["P1", "PE2"], PE2: ["P2"] };
const pe2 = buildLsp("PE2", 1, NB.PE2);
const all1 = (["PE1", "P1", "P2", "PE2"] as IsisRouter[]).map((r) => buildLsp(r, 1, NB[r]));

function TopologyDiagram() {
  return (
    <DiagramSvg h={170} label="PE1, P1, P2 and PE2 in a line; loopbacks 10.0.0.1 to 10.0.0.4; transit /31 links">
      <IsisChain y={84} subs={{ PE1: `${ROUTER.PE1.loopback}/32`, P1: `${ROUTER.P1.loopback}/32`, P2: `${ROUTER.P2.loopback}/32`, PE2: `${ROUTER.PE2.loopback}/32` }} labels={{ a: "192.0.2.0/31", b: "192.0.2.2/31", c: "192.0.2.4/31" }} below={{ a: `metric ${LINK_METRIC}`, b: `metric ${LINK_METRIC}`, c: `metric ${LINK_METRIC}` }} />
      <text x={320} y={158} textAnchor="middle" fill={D.muted} fontSize={10}>
        Three Ethernet links run as IS-IS point-to-point circuits · every router Level-2-only
      </text>
    </DiagramSvg>
  );
}

function NetDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={150} label="NET 49.0001.0000.0000.0001.00 split into Area ID 49.0001, System ID 0000.0000.0001 and NSEL 00">
      <text x={320} y={22} textAnchor="middle" fill={D.text} fontSize={12} fontFamily="monospace" fontWeight={700}>
        {netOf("PE1")}
      </text>
      <DFieldRow x={70} y={34} fields={[f("Area ID", AREA, 150, D.violet), f("System ID", ROUTER.PE1.sysId, 250, D.cyan, true), f("NSEL", "00", 100, D.faint)]} />
      <text x={320} y={108} textAnchor="middle" fill={D.muted} fontSize={10}>
        System ID: unique per router (six bytes) · NSEL 00 = &quot;this is the router itself&quot;
      </text>
      <text x={320} y={126} textAnchor="middle" fill={D.muted} fontSize={10}>
        The NET names the IS-IS router. It is not an interface address and never an IPv4 next hop.
      </text>
    </DiagramSvg>
  );
}

function L2Diagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={190} label="IS-IS PDUs are carried in 802.3 with LLC FE FE 03 and the 0x83 header, with no IPv4, UDP or TCP">
      <text x={20} y={22} fill={D.success} fontSize={10.5} fontWeight={700}>
        IS-IS (this lesson)
      </text>
      <DFieldRow x={20} y={30} fields={[f("802.3", `dst ${ALL_ISS}`, 190, D.eth), f("LLC", "FE · FE · 03", 110, D.violet, true), f("IS-IS header", "0x83 · type", 130, D.cyan, true), f("PDU + TLVs", "IIH / LSP / SNP", 170, D.cyan)]} />
      <text x={20} y={112} fill={D.danger} fontSize={10.5} fontWeight={700}>
        Not this
      </text>
      <DFieldRow x={20} y={120} h={36} fields={[f("Ethernet", "", 150, D.faint), f("IPv4", "", 120, D.faint), f("UDP / TCP", "", 120, D.faint), f("IS-IS", "", 210, D.faint)]} />
      <line x1={20} y1={138} x2={620} y2={138} stroke={D.danger} strokeWidth={2} />
      <text x={320} y={182} textAnchor="middle" fill={D.muted} fontSize={10}>
        Routing IP without depending on IP: IS-IS works before any IPv4 route exists.
      </text>
    </DiagramSvg>
  );
}

function IihDiagram() {
  return (
    <DiagramSvg h={196} label="P2P IIH fields: circuit type, source ID, holding time, PDU length, local circuit ID and TLVs 1, 129, 132 and 240">
      <DTable
        x={60}
        y={8}
        title={`P1's P2P IIH (PDU type ${PDU.P2P_IIH})`}
        cols={[
          { label: "FIELD / TLV", w: 220 },
          { label: "VALUE", w: 300 },
        ]}
        rows={[
          ["Circuit Type", "2 (Level-2 only)"],
          ["Source ID · Holding Time", `${ROUTER.P1.sysId} · 30 s`],
          ["PDU Length · Local Circuit ID", "unpadded length · 2"],
          ["TLV 1 Area · TLV 129 Protocols", `${AREA} · 0xCC (IPv4)`],
          ["TLV 132 IP Interface Address", "192.0.2.2"],
          ["TLV 240 Three-Way Adjacency", "state · ext. circuit ID · neighbor"],
        ]}
      />
    </DiagramSvg>
  );
}

function ThreeWayDiagram() {
  return (
    <DiagramSvg h={200} label="Three-way handshake: P1 sends Down, P2 moves to Initializing and answers listing P1, P1 goes Up and answers Up, P2 goes Up">
      <Lanes
        lanes={[
          { x: 150, label: "P1", color: D.cyan },
          { x: 490, label: "P2", color: D.cyan },
        ]}
        msgs={[
          { from: 0, to: 1, label: "IIH · TLV 240 state Down (2)", sub: "P2: Down → Initializing" },
          { from: 1, to: 0, label: "IIH · Initializing (1) · neighbor P1", sub: "P1: Down → Up (its own ID echoed)" },
          { from: 0, to: 1, label: "IIH · Up (0) · neighbor P2", sub: "P2: Initializing → Up" },
        ]}
      />
      <text x={320} y={178} textAnchor="middle" fill={D.muted} fontSize={10}>
        Up needs proof of two-way communication: your own System ID in the neighbor&apos;s hello.
      </text>
    </DiagramSvg>
  );
}

function UpDiagram() {
  return (
    <DiagramSvg h={150} label="All three adjacencies Level-2 Up while the Ethernet links are simply up">
      <IsisChain y={76} segs={{ a: "both", b: "both", c: "both" }} colors={{ a: D.success, b: D.success, c: D.success }} labels={{ a: "L2 adj UP", b: "L2 adj UP", c: "L2 adj UP" }} below={{ a: "Ethernet up", b: "Ethernet up", c: "Ethernet up" }} />
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        Two separate facts per link: frames get through (Ethernet) and IS-IS agreed to route over it (adjacency).
      </text>
    </DiagramSvg>
  );
}

function LspDiagram() {
  return (
    <DiagramSvg h={206} label="PE2's LSP: LSP ID, sequence 1, lifetime 1200, checksum, TLV 22 neighbor P2 metric 10, TLV 135 10.0.0.4/32 metric 10">
      <DTable
        x={30}
        y={8}
        title={`PE2's Level-2 LSP (PDU type ${PDU.L2_LSP}) · ${lspLength(pe2)} bytes`}
        cols={[
          { label: "FIELD / TLV", w: 210 },
          { label: "VALUE", w: 370 },
        ]}
        rows={[
          ["LSP ID", `${pe2.id} (System ID · pseudonode 00 · fragment 00)`],
          ["Sequence · Remaining Lifetime", `${hex8s(pe2.seq)} · ${LSP_LIFETIME} s`],
          ["Checksum (Fletcher)", `${hex4(lspChecksum(pe2))} · LSP ID → end (lifetime excluded)`],
          ["TLV 22 Extended IS Reachability", `${ROUTER.P2.sysId}.00 (P2) · metric ${LINK_METRIC}`],
          ["TLV 135 Extended IP Reachability", `10.0.0.4/32 · metric ${PREFIX_METRIC}`],
          ["Also: TLV 1 · 129 · 132 · 137", `area · IPv4 · 10.0.0.4 · hostname PE2`],
        ]}
        highlight={{ row: 4, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function FloodDiagram() {
  return (
    <DiagramSvg h={170} label="PE2's LSP floods PE2 to P2 to P1 to PE1; each receiver acknowledges with a PSNP">
      <IsisChain y={84} segs={{ a: "left", b: "left", c: "left" }} colors={{ a: D.warning, b: D.warning, c: D.warning }} labels={{ a: "← LSP · 3", b: "← LSP · 2", c: "← LSP · 1" }} below={{ a: "PSNP ack →", b: "PSNP ack →", c: "PSNP ack →" }} />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        Newer sequence → install, acknowledge, flood on every other adjacency — never back out the ingress.
      </text>
    </DiagramSvg>
  );
}

function SyncDiagram() {
  return (
    <DiagramSvg h={196} label="CSNP summarizes LSP headers; PSNP acknowledges or requests specific LSPs">
      <Lanes
        lanes={[
          { x: 150, label: "P1", color: D.cyan },
          { x: 490, label: "P2", color: D.cyan },
        ]}
        msgs={[
          { from: 1, to: 0, label: `CSNP (${PDU.L2_CSNP}) · 4 LSP entries`, sub: "ID · seq · lifetime · checksum — not routes", color: D.violet },
          { from: 0, to: 1, label: `PSNP (${PDU.L2_PSNP}) · request 0000.0000.0003.00-00`, sub: "entry = P1's older copy (seq 1) → P2 sees it is older", color: D.success },
          { from: 1, to: 0, label: `LSP (${PDU.L2_LSP}) · the requested LSP`, color: D.warning },
          { from: 0, to: 1, label: `PSNP (${PDU.L2_PSNP}) · ack`, color: D.success },
        ]}
      />
    </DiagramSvg>
  );
}

function LsdbDiagram() {
  return (
    <DiagramSvg h={170} label="The converged Level-2 LSDB: four LSPs at sequence 1 on every router">
      <DTable
        x={20}
        y={8}
        title="Level-2 LSDB — identical on PE1, P1, P2 and PE2"
        cols={[
          { label: "LSP ID", w: 180 },
          { label: "SEQ", w: 100 },
          { label: "CHECKSUM", w: 90 },
          { label: "IS NEIGHBORS", w: 110 },
          { label: "IPv4", w: 120 },
        ]}
        rows={all1.map((l) => [l.id, hex8s(l.seq), hex4(lspChecksum(l)), l.isReach.map((n) => n.neighbor).join(", "), `${l.ipReach[0].prefix}/32`])}
      />
    </DiagramSvg>
  );
}

function SpfDiagram() {
  return (
    <DiagramSvg h={180} label="SPF from PE1: P1 at 10, P2 at 20, PE2 at 30, and 10.0.0.4/32 at 40 via P1">
      <IsisChain y={80} segs={{ a: "right", b: "right", c: "right" }} colors={{ a: D.success, b: D.success, c: D.success }} labels={{ a: "+10", b: "+10", c: "+10" }} subs={{ PE1: "root · 0", P1: "dist 10", P2: "dist 20", PE2: "dist 30" }} />
      <DPill x={564} y={140} text="+ prefix 10 → 40" color={D.warning} w={150} />
      <text x={250} y={146} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
        PE1: 10.0.0.4/32 metric 40 via P1 (192.0.2.1)
      </text>
      <text x={320} y={170} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Links used only if both ends report them (two-way check). P1 sees 30, P2 sees 20, PE2 advertises 10.
      </text>
    </DiagramSvg>
  );
}

function FwdDiagram() {
  return (
    <DiagramSvg h={170} label="An ordinary ICMP packet from 10.0.0.1 to 10.0.0.4 is forwarded hop by hop using the IS-IS routes">
      <IsisChain y={80} segs={{ a: "right", b: "right", c: "right" }} colors={{ a: D.ip, b: D.ip, c: D.ip }} labels={{ a: "TTL 64", b: "TTL 63", c: "TTL 62" }} />
      <text x={320} y={140} textAnchor="middle" fill={D.ip} fontSize={10.5} fontWeight={700}>
        Ethernet + IPv4 10.0.0.1 → 10.0.0.4 + ICMP — no IIH, LSP, SNP or TLV
      </text>
      <text x={320} y={158} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        IS-IS built the routes (control plane); IPv4 forwarding moves the packet (data plane).
      </text>
    </DiagramSvg>
  );
}

function IncidentDiagram() {
  return (
    <DiagramSvg h={190} label="Level mismatch: P1 circuit Level-2-only, P2 circuit Level-1-only, Ethernet up, adjacency down, PE1 loses 10.0.0.4">
      <IsisChain y={80} segs={{ a: "both", b: "down", c: "both" }} colors={{ a: D.success, c: D.success }} labels={{ a: "L2 UP", b: "IS-IS adj DOWN", c: "L2 UP" }} below={{ a: "Ethernet up", b: "Ethernet UP", c: "Ethernet up" }} subs={{ P1: "circuit L2 (type 2)", P2: "circuit L1 (type 1)" }} accents={{ P2: D.danger }} />
      <text x={320} y={148} textAnchor="middle" fill={D.danger} fontSize={10.5} fontWeight={700}>
        No common level on P1–P2 → no adjacency → partition → PE1 has no route to 10.0.0.4
      </text>
      <text x={320} y={168} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        P1 re-originates its LSP (seq 1 → 2) without P2. Stale LSPs may linger, but SPF can&apos;t use a one-way link.
      </text>
    </DiagramSvg>
  );
}

function RepairDiagram() {
  return (
    <DiagramSvg h={252} label="Repair: P2 back to Level 2, three-way handshake, P1 LSP sequence 3, CSNP, PSNP request, P2 LSP, SPF route restored">
      <Lanes
        lanes={[
          { x: 150, label: "P1", color: D.cyan },
          { x: 490, label: "P2", color: D.cyan },
        ]}
        msgs={[
          { from: 1, to: 0, label: "IIH · circuit type 2 · Down", sub: "P1: Down → Initializing" },
          { from: 0, to: 1, label: "IIH · Initializing · neighbor P2", sub: "P2: Down → Up" },
          { from: 1, to: 0, label: "IIH · Up · neighbor P1", sub: "P1: Initializing → Up" },
          { from: 0, to: 1, label: "LSP P1 seq 0x00000003", color: D.warning },
          { from: 1, to: 0, label: "CSNP → PSNP request → LSP P2 seq 3", color: D.violet },
        ]}
      />
      <DPill x={320} y={232} text="PE1 SPF: 10.0.0.4/32 metric 40 via P1 — ping delivered" color={D.success} w={380} />
    </DiagramSvg>
  );
}

export function IsisLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="isl-mission" eyebrow="Mission" title="An IGP for the provider core" tone="cyan">
        <p>IS-IS gives every router in the core the same picture of the topology and lets each compute shortest paths to every loopback. It does this without riding on IP — which is exactly why it can build IP routing from nothing.</p>
        <FlowSteps
          steps={[
            { title: "Adjacency", body: "P2P IIHs with a three-way handshake.", tone: "success" },
            { title: "Flooding", body: "Sequence-numbered LSPs, acknowledged with PSNPs.", tone: "warning" },
            { title: "Synchronization", body: "CSNPs compare databases; PSNPs request what is missing.", tone: "violet" },
            { title: "SPF", body: "Shortest-path tree → IPv4 routes.", tone: "ip" },
          ]}
        />
      </GuideSection>

      <GuideSection id="isl-topology" eyebrow="Topology" title="PE1 — P1 — P2 — PE2" tone="cyan">
        <DiagramFrame caption="Loopbacks advertised; wide metric 10 per link.">
          <TopologyDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="Why Level-2-only?">
          A single Level-2 domain is a simple provider-backbone design. Many networks also use Level-1 areas and Level-1/2 routers — see the Deep Dive.
        </Callout>
      </GuideSection>

      <GuideSection id="isl-net" eyebrow="Identity" title="NET decomposition" tone="violet">
        <DiagramFrame caption="Read the NET right to left.">
          <NetDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isl-l2" eyebrow="Encapsulation" title="IS-IS directly over Layer 2" tone="ethernet">
        <DiagramFrame caption="802.3 + LLC, then IS-IS. No IP anywhere in the control plane.">
          <L2Diagram />
        </DiagramFrame>
        <p>
          The links are Ethernet configured as point-to-point circuits (RFC 5309): PDUs go to AllISs <Mono>{ALL_ISS}</Mono>, there is no DIS election and no pseudonode.
        </p>
      </GuideSection>

      <GuideSection id="isl-iih" eyebrow="Hello" title="The point-to-point IIH" tone="success">
        <DiagramFrame caption="PDU type 17 carries both levels; the circuit-type field says which.">
          <IihDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isl-3way" eyebrow="RFC 5303" title="The three-way handshake" tone="success">
        <DiagramFrame caption="TLV 240 state values: Up 0, Initializing 1, Down 2.">
          <ThreeWayDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isl-up" eyebrow="Adjacencies" title="All three Up" tone="success">
        <DiagramFrame caption="Link state and adjacency state are different facts.">
          <UpDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isl-lsp" eyebrow="LSP" title="Anatomy of PE2's LSP" tone="warning">
        <DiagramFrame caption="Each router describes only itself.">
          <LspDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isl-flood" eyebrow="Flooding" title="PE2 → P2 → P1 → PE1" tone="warning">
        <DiagramFrame caption="Control-plane flooding, not user-data forwarding.">
          <FloodDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isl-sync" eyebrow="Synchronization" title="CSNP and PSNP" tone="violet">
        <DiagramFrame caption="Summaries and requests — the model's re-convergence shows all four messages.">
          <SyncDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isl-lsdb" eyebrow="Database" title="One Level-2 LSDB" tone="cyan">
        <DiagramFrame caption="Each Fletcher checksum covers its LSP from the LSP ID to the end; Remaining Lifetime is excluded.">
          <LsdbDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isl-spf" eyebrow="SPF" title="PE1's shortest path to 10.0.0.4" tone="ip">
        <DiagramFrame caption="10 + 10 + 10 to reach PE2, plus the prefix metric 10.">
          <SpfDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isl-fwd" eyebrow="Data plane" title="Ordinary IPv4 forwarding" tone="ip">
        <DiagramFrame caption="The user packet contains no IS-IS at all.">
          <FwdDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="isl-incident" eyebrow="Incident" title="A level mismatch" tone="danger">
        <DiagramFrame caption="Every cable up; the routing domain split in two.">
          <IncidentDiagram />
        </DiagramFrame>
        <p>P2&apos;s P1-facing circuit became Level-1-only. Both routers still send P2P IIHs, but P1 runs only Level 2 there and P2 only Level 1, so no adjacency can exist. There is no alternate path, so PE1 loses PE2&apos;s loopback. This is not an ARP, subnet, BGP, MPLS or cabling problem.</p>
      </GuideSection>

      <GuideSection id="isl-repair" eyebrow="Repair" title="Restore Level 2, re-converge, verify" tone="success">
        <DiagramFrame caption="Sequence numbers only move forward: 1 → 2 → 3.">
          <RepairDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Verified" mark="✓" items={["P2 ge-0/0/0 Level-2-only again", "P1–P2 adjacency Up (Down → Initializing → Up)", "P1 LSP seq 3 and P2 LSP seq 3 flooded; databases synchronized", "PE1: 10.0.0.4/32 metric 40 via P1; ping delivered"]} />
      </GuideSection>

      <GuideSection id="isl-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "NET", def: "Network Entity Title: area + System ID + NSEL 00." },
            { term: "IIH", def: "IS-IS Hello; type 17 on point-to-point circuits." },
            { term: "LSP", def: "Link State PDU describing one router; type 20 at Level 2." },
            { term: "CSNP / PSNP", def: "Complete / Partial Sequence Number PDUs: database summary / ack or request." },
            { term: "Three-way TLV 240", def: "Proves two-way communication before an adjacency comes Up." },
            { term: "Two-way check", def: "SPF uses a link only when both ends report it." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
