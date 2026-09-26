import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DStack } from "@/components/lesson/MplsGuideSvg";
import { DHeaderColumn, Srv6Topology, type Srv6Link, type Srv6Pos } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { CUST_A_DT4, GLOBAL_DT4, HEADER_MPLS_BYTES, HEADER_SEGMENTS, HEADER_SRV6_BYTES, MPLS_TE_STACK, REPAIR_SOURCE, SHARED_REPAIR, SRV6_TE_INITIAL_SL, SRV6_TE_PROGRAM, SRV6_TE_SRH, TRANSPORT_LABEL, TRANSPORT_SOURCE, VPN_LABEL_PE2 } from "./guideModel";

export const SRCMP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lk-mission", label: "The mission" },
  { id: "lk-topology", label: "One shared topology" },
  { id: "lk-transport", label: "Transport, side by side" },
  { id: "lk-te", label: "Explicit TE, side by side" },
  { id: "lk-count", label: "Why 3 labels vs 2 SIDs here" },
  { id: "lk-vpn", label: "L3VPN, side by side" },
  { id: "lk-tilfa", label: "One TI-LFA computation" },
  { id: "lk-header", label: "Header efficiency" },
  { id: "lk-incident", label: "The cross-architecture incident" },
  { id: "lk-matrix", label: "Trade-offs, not a winner" },
  { id: "lk-glossary", label: "Glossary" },
  { id: "lk-recap", label: "Mental model" },
];

const POS: Srv6Pos = {
  CE1: [40, 110],
  PE1: [130, 110],
  P1: [225, 110],
  P2: [400, 40],
  PE2: [510, 90],
  P3: [285, 190],
  P4: [400, 190],
  CE2: [600, 110],
};
const LINKS: Srv6Link[] = [
  { a: "CE1", b: "PE1" },
  { a: "PE1", b: "P1" },
  { a: "P1", b: "P2" },
  { a: "P2", b: "PE2" },
  { a: "P1", b: "P3" },
  { a: "P3", b: "P4" },
  { a: "P4", b: "P2" },
  { a: "P4", b: "PE2" },
  { a: "PE2", b: "CE2" },
];

function TopologyDiagram() {
  return (
    <DiagramSvg h={240} label="Shared topology: CE1, PE1, P1, P2, PE2, CE2 on the primary path; P3 and P4 form the alternate core; both architectures use exactly the same routers and links">
      <Srv6Topology pos={POS} links={LINKS} sub={{ PE1: "headend", P1: "PLR", PE2: "egress" }} accent={{ CE1: D.faint, CE2: D.faint, PE1: D.ip, PE2: D.success, P1: D.warning }} boxW={62} />
      <text x={320} y={232} textAnchor="middle" fill={D.muted} fontSize={10}>
        same routers, same links, same IGP metrics for SR-MPLS and SRv6 — only the packet encoding differs
      </text>
    </DiagramSvg>
  );
}

function TransportDiagram() {
  return (
    <DiagramSvg h={200} label={`Shortest-path transport: SR-MPLS pushes Node-SID label ${TRANSPORT_LABEL} above customer IPv4; SRv6 adds an outer IPv6 header with destination ${GLOBAL_DT4}, PE2's global-table End.DT4, and no SRH`}>
      <text x={160} y={20} textAnchor="middle" fill={D.mpls} fontSize={12} fontWeight={700}>
        SR-MPLS
      </text>
      <DStack x={160} y={32} w={150} labels={[{ text: `${TRANSPORT_LABEL} S1`, color: D.mpls, tag: "PE2" }]} payload="customer IPv4" caption="Node-SID(PE2), bottom of stack" />
      <text x={470} y={20} textAnchor="middle" fill={D.ip} fontSize={12} fontWeight={700}>
        SRv6
      </text>
      <DHeaderColumn
        x={470}
        y={32}
        w={250}
        rows={[
          { text: `SA ${TRANSPORT_SOURCE} (PE1)`, color: D.ip },
          { text: `DA ${GLOBAL_DT4}`, color: D.ip, strong: true, tag: "DA" },
          { text: "customer IPv4", color: D.eth },
        ]}
        caption="PE2 End.DT4 (global table) · no SRH"
      />
    </DiagramSvg>
  );
}

function TeDiagram() {
  return (
    <DiagramSvg h={230} label={`Explicit TE: SR-MPLS stack ${MPLS_TE_STACK.map((l) => `${l.label} S${l.s}`).join(", ")}; SRv6 destination ${SRV6_TE_PROGRAM[0]?.sid} with SRH Segments Left ${SRV6_TE_INITIAL_SL}, list ${SRV6_TE_SRH.map((e) => `[${e.index}] ${e.name}`).join(", ")}`}>
      <text x={160} y={20} textAnchor="middle" fill={D.mpls} fontSize={12} fontWeight={700}>
        SR-MPLS · {MPLS_TE_STACK.length} labels
      </text>
      <DStack x={160} y={32} w={150} labels={MPLS_TE_STACK.map((l) => ({ text: `${l.label} S${l.s}`, color: D.mpls }))} payload="customer IPv4" caption={MPLS_TE_STACK.map((l) => l.meaning).join(" · ")} />
      <text x={470} y={20} textAnchor="middle" fill={D.ip} fontSize={12} fontWeight={700}>
        SRv6 · {SRV6_TE_PROGRAM.length} SIDs
      </text>
      <DHeaderColumn
        x={470}
        y={32}
        w={270}
        rows={[
          { text: `DA ${SRV6_TE_PROGRAM[0]?.sid}`, color: D.ip, strong: true, tag: "DA" },
          { text: `SRH · SL ${SRV6_TE_INITIAL_SL} · LE ${SRV6_TE_SRH.length - 1}`, color: D.violet, tag: "SRH" },
          ...SRV6_TE_SRH.map((e) => ({ text: `[${e.index}] ${e.name}`, color: D.violet })),
          { text: "customer IPv4", color: D.eth },
        ]}
      />
    </DiagramSvg>
  );
}

function VpnDiagram() {
  return (
    <DiagramSvg h={200} label={`L3VPN: SR-MPLS carries transport label ${TRANSPORT_LABEL} over VPN label ${VPN_LABEL_PE2}; SRv6 carries one outer IPv6 header whose destination is the CUST-A Service SID ${CUST_A_DT4}`}>
      <text x={160} y={20} textAnchor="middle" fill={D.mpls} fontSize={12} fontWeight={700}>
        SR-MPLS L3VPN
      </text>
      <DStack
        x={160}
        y={32}
        w={150}
        labels={[
          { text: `${TRANSPORT_LABEL} S0`, color: D.mpls, tag: "TRANSPORT" },
          { text: `${VPN_LABEL_PE2} S1`, color: D.bgp, tag: "VPN" },
        ]}
        payload="customer IPv4"
        caption="transport over VPN label"
      />
      <text x={470} y={20} textAnchor="middle" fill={D.ip} fontSize={12} fontWeight={700}>
        SRv6 L3VPN
      </text>
      <DHeaderColumn
        x={470}
        y={32}
        w={250}
        rows={[
          { text: `DA ${CUST_A_DT4}`, color: D.bgp, strong: true, tag: "DA" },
          { text: "customer IPv4", color: D.eth },
        ]}
        caption="Service SID: End.DT4 in VRF CUST-A"
      />
      <text x={320} y={186} textAnchor="middle" fill={D.muted} fontSize={10}>
        {CUST_A_DT4} (VRF CUST-A) is not {GLOBAL_DT4} (global table)
      </text>
    </DiagramSvg>
  );
}

function TiLfaDiagram() {
  return (
    <DiagramSvg h={230} label={`One TI-LFA computation: repair node ${SHARED_REPAIR.repairNode}, merge ${SHARED_REPAIR.mergeTarget}, outgoing interface P1 to ${SHARED_REPAIR.oif}. SR-MPLS pushes ${SHARED_REPAIR.mplsLabels.join(", ")} above ${TRANSPORT_LABEL}; SRv6 adds a repair outer from P1 to ${SHARED_REPAIR.srv6Sid} around the PE1 transport outer`}>
      <text x={320} y={18} textAnchor="middle" fill={D.text} fontSize={11.5} fontWeight={700}>
        shared result: OIF P1→{SHARED_REPAIR.oif} · repair {SHARED_REPAIR.repairNode}→{SHARED_REPAIR.mergeTarget}
      </text>
      <DStack
        x={160}
        y={40}
        w={150}
        labels={[...SHARED_REPAIR.mplsLabels.map((v) => ({ text: `${v} S0`, color: D.warning, tag: "REPAIR" })), { text: `${TRANSPORT_LABEL} S1`, color: D.mpls, tag: "TRANSPORT" }]}
        payload="customer IPv4"
        caption="repair labels above the transport label"
      />
      <DHeaderColumn
        x={470}
        y={40}
        w={280}
        rows={[
          { text: `SA ${REPAIR_SOURCE} (P1)`, color: D.warning, tag: "REPAIR" },
          { text: `DA ${SHARED_REPAIR.srv6Sid} · no SRH`, color: D.warning, strong: true },
          { text: `SA ${TRANSPORT_SOURCE} (PE1)`, color: D.ip, tag: "TRANSPORT" },
          { text: `DA ${GLOBAL_DT4}`, color: D.ip },
          { text: "customer IPv4", color: D.eth },
        ]}
      />
    </DiagramSvg>
  );
}

function HeaderDiagram() {
  const max = HEADER_SRV6_BYTES;
  const bar = (y: number, label: string, bytes: number, color: string) => (
    <g>
      <text x={24} y={y + 17} fill={D.text} fontSize={11} fontWeight={700}>
        {label}
      </text>
      <rect x={230} y={y} width={(bytes / max) * 330} height={26} rx={6} fill={color} fillOpacity={0.2} stroke={color} strokeOpacity={0.8} />
      <text x={236 + (bytes / max) * 330} y={y + 17} fill={color} fontSize={10.5} fontWeight={700} fontFamily="monospace">
        {bytes} B
      </text>
    </g>
  );
  return (
    <DiagramSvg h={140} label={`${HEADER_SEGMENTS}-segment program: SR-MPLS instruction storage ${HEADER_MPLS_BYTES} bytes, uncompressed SRv6 ${HEADER_SRV6_BYTES} bytes`}>
      {bar(24, `SR-MPLS (${HEADER_SEGMENTS} labels)`, HEADER_MPLS_BYTES, D.mpls)}
      {bar(62, `SRv6 (${HEADER_SEGMENTS} SIDs)`, HEADER_SRV6_BYTES, D.ip)}
      <text x={320} y={124} textAnchor="middle" fill={D.muted} fontSize={10}>
        instruction storage only · the lesson&apos;s CSID lab then compresses the SRv6 side
      </text>
    </DiagramSvg>
  );
}

function LadderDiagram() {
  const steps = ["Physical / IGP adjacency", "Transport reachability", "Control plane (BGP route)", "Service import (RT / VRF)", "Service data plane"];
  return (
    <DiagramSvg h={220} label="Troubleshooting ladder shared by both architectures: physical and IGP, transport reachability, BGP route, service import, service data plane">
      {steps.map((s, i) => (
        <g key={s}>
          <rect x={150} y={14 + i * 38} width={340} height={30} rx={8} fill={D.cyan} fillOpacity={0.08} stroke={D.cyan} strokeOpacity={0.6} />
          <text x={320} y={34 + i * 38} textAnchor="middle" fill={D.text} fontSize={11}>
            {i + 1}. {s}
          </text>
          {i < steps.length - 1 && <DArrow x1={505} y1={29 + i * 38} x2={505} y2={63 + i * 38} color={D.faint} width={1.4} />}
        </g>
      ))}
      <text x={320} y={210} textAnchor="middle" fill={D.muted} fontSize={10}>
        same ladder for both — what you inspect at each rung differs
      </text>
    </DiagramSvg>
  );
}

export function SrMplsVsSrv6LessonGuideContent() {
  return (
    <>
      <GuideSection id="lk-mission" eyebrow="Introduction" title="The mission: one architecture, two encodings" tone="cyan">
        <p>
          SR-MPLS and SRv6 both implement the Segment Routing architecture (RFC 8402). This capstone solves one brief twice — transport, explicit TE, L3VPN, fast protection — on the same routers, and compares what changes in the packet and in each router.
        </p>
        <Callout tone="cyan" title="Neutral by design" icon="i">
          The lesson does not crown a winner. Each comparison is scoped to this modeled network; the right choice depends on requirements.
        </Callout>
      </GuideSection>

      <GuideSection id="lk-topology" eyebrow="Setup" title="One shared topology" tone="ospf">
        <DiagramFrame caption="The data-plane topology. The route reflector exchanges BGP routes only and is never a packet hop.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lk-transport" eyebrow="Phase 1" title="Transport, side by side" tone="ip">
        <DiagramFrame caption="Both deliver CE1 → CE2 over the shortest path.">
          <TransportDiagram />
        </DiagramFrame>
        <FieldTable
          title="Who does what"
          accent="ip"
          columns={["Router", "SR-MPLS", "SRv6"]}
          rows={[
            ["PE1", `push ${TRANSPORT_LABEL}`, "H.Encaps to PE2's global End.DT4"],
            ["P1", "swap to the same global label", "IPv6 FIB forward"],
            ["P2", "PHP (penultimate hop)", "IPv6 FIB forward"],
            ["PE2", "IPv4 lookup", "End.DT4: decapsulate, global IPv4 lookup"],
          ]}
        />
      </GuideSection>

      <GuideSection id="lk-te" eyebrow="Phase 2" title="Explicit TE, side by side" tone="warning">
        <DiagramFrame caption="Both steer PE1 → P1 → P3 → P4 → P2 → PE2.">
          <TeDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lk-count" eyebrow="Phase 2" title="Why 3 labels vs 2 SIDs here" tone="warning">
        <CompareCards
          items={[
            { title: "SR-MPLS (this model)", tone: "mpls", tag: `${MPLS_TE_STACK.length} labels`, points: ["Adj-SID(P4→P2) is modeled as locally significant", "So Node-SID(P4) must first bring the packet to P4"] },
            { title: "SRv6 (this model)", tone: "ip", tag: `${SRV6_TE_PROGRAM.length} SIDs`, points: ["End.X(P4→P2) is globally routed via P4's locator", "It reaches P4 AND forces the P4→P2 link"] },
          ]}
        />
        <p>RFC 8402 also allows globally significant MPLS Adj-SIDs, so this count difference belongs to this model — it is not a ranking of the architectures.</p>
      </GuideSection>

      <GuideSection id="lk-vpn" eyebrow="Phase 3" title="L3VPN, side by side" tone="bgp">
        <DiagramFrame caption="Same VRF, RD, RT and MP-BGP; different service identifier on the wire.">
          <VpnDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lk-tilfa" eyebrow="Phase 4" title="One TI-LFA computation" tone="danger">
        <DiagramFrame caption="Both repairs are added on top of the real transport instruction.">
          <TiLfaDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lk-header" eyebrow="Phase 5" title="Header efficiency" tone="cyan">
        <DiagramFrame caption="Computed from the lesson's own byte helpers.">
          <HeaderDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lk-incident" eyebrow="Troubleshooting" title="The cross-architecture incident" tone="danger">
        <DiagramFrame caption="Walk the ladder from the bottom; stop at the first failing rung.">
          <LadderDiagram />
        </DiagramFrame>
        <ChecklistCard
          tone="danger"
          title="How to reason about it (no spoilers)"
          mark="→"
          items={["One architecture works and the other does not — so compare them rung by rung.", "Check what the failing side needs from the network that the working side does not.", "Apply one fix, then resend to prove the data plane."]}
        />
      </GuideSection>

      <GuideSection id="lk-matrix" eyebrow="Decisions" title="Trade-offs, not a winner" tone="warning">
        <FieldTable
          title="Encoding trade-offs"
          accent="warning"
          columns={["Aspect", "SR-MPLS", "SRv6"]}
          rows={[
            ["Instruction size", "4-byte labels", "16-byte SIDs (compressible)"],
            ["Core state", "LFIB", "ordinary IPv6 FIB"],
            ["Operational base", "existing MPLS tooling and skills", "IPv6-native, programmable endpoints"],
          ]}
        />
      </GuideSection>

      <GuideSection id="lk-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "S bit", def: "Bottom-of-stack flag: 1 only on the last MPLS label." },
            { term: "PHP", def: "Penultimate Hop Popping: the router before the owner removes the Node-SID label." },
            { term: "Global End.DT4", def: `PE2's provider-table decapsulation SID (${GLOBAL_DT4}).` },
            { term: "Service SID", def: `CUST-A's VRF End.DT4 SID (${CUST_A_DT4}).` },
            { term: "Adj-SID / End.X", def: "Adjacency segments that force one specific link." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lk-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          Same topology, same computations, same services — SR-MPLS encodes the program as a label stack read by the LFIB, SRv6 as IPv6 destinations and an SRH read by the IPv6 FIB and Local SID Tables; <Mono>neither</Mono> is universally better.
        </Callout>
      </GuideSection>
    </>
  );
}
