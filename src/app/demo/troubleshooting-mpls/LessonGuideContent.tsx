import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DiagramFrame, DiagramSvg, DLink, DNode, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DFieldRow, DTable } from "@/components/lesson/FundamentalsGuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { LadderDiagram, SeqLanes, WorkflowDiagram } from "@/components/lesson/TroubleshootingGuideSvg";
import { CUST, LDP_LABEL, LOOP, RD, RT_INTENDED, RT_WRONG, VPN_LABEL, VRF } from "@/lib/sim-engine/scenarios/troubleshootingMpls";

export const MP_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "mpl-mission", label: "The mission" },
  { id: "mpl-method", label: "The method" },
  { id: "mpl-topology", label: "Topology" },
  { id: "mpl-planes", label: "Five planes" },
  { id: "mpl-rd-rt", label: "RD vs RT" },
  { id: "mpl-update", label: "The VPNv4 route" },
  { id: "mpl-import", label: "Import decision" },
  { id: "mpl-stack", label: "The label stack" },
  { id: "mpl-hops", label: "Hop by hop" },
  { id: "mpl-p", label: "P-router behavior" },
  { id: "mpl-transport", label: "Transport evidence" },
  { id: "mpl-received", label: "Received vs imported" },
  { id: "mpl-stop", label: "Where traffic stops" },
  { id: "mpl-verify", label: "Repair & verify" },
  { id: "mpl-glossary", label: "Glossary" },
];

function TopologyDiagram() {
  return (
    <DiagramSvg h={170} label="CE1, PE1, P1, P2, PE2 and CE2 in a line; the core runs an IGP and LDP; MP-BGP runs between PE1 and PE2">
      <rect x={110} y={34} width={420} height={96} rx={14} fill={D.violet} fillOpacity={0.05} stroke={D.violet} strokeOpacity={0.4} strokeDasharray="6 5" />
      <text x={122} y={50} fill={D.violet} fontSize={9.5} fontWeight={700}>
        MPLS core · IGP + LDP
      </text>
      {[
        { x: 55, n: "CE1", s: `${CUST.ce1Lan}/24`, c: D.cyan },
        { x: 160, n: "PE1", s: LOOP.PE1, c: D.warning },
        { x: 265, n: "P1", s: LOOP.P1, c: D.violet },
        { x: 375, n: "P2", s: LOOP.P2, c: D.violet },
        { x: 480, n: "PE2", s: LOOP.PE2, c: D.warning },
        { x: 585, n: "CE2", s: `${CUST.ce2Lan}/24`, c: D.cyan },
      ].map((h, i, all) => (
        <g key={h.n}>
          <DNode x={h.x} y={95} label={h.n} sub={h.s} accent={h.c} w={92} />
          {i < all.length - 1 && <DLink x1={h.x + 46} y1={95} x2={all[i + 1].x - 46} y2={95} />}
        </g>
      ))}
      <path d="M160 66 C 250 20, 390 20, 480 66" fill="none" stroke={D.danger} strokeDasharray="4 4" strokeWidth={1.4} />
      <text x={320} y={26} textAnchor="middle" fill={D.danger} fontSize={9} fontFamily="monospace">
        MP-BGP VPNv4 {LOOP.PE1} ↔ {LOOP.PE2}
      </text>
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Customer routes live only on the PEs, in VRF {VRF}.
      </text>
    </DiagramSvg>
  );
}

function PlanesDiagram() {
  return (
    <DiagramSvg h={150} label="Five planes during the incident: underlay, transport and VPN session healthy; VRF import failing; data plane failing as a result">
      <LadderDiagram
        rows={[
          { rung: "Underlay (IGP)", evidence: `PE1 reaches ${LOOP.PE2}/32`, status: "ok" },
          { rung: "Transport (LDP)", evidence: `label ${LDP_LABEL.toPE2.P1} · LSP ping 5/5`, status: "ok" },
          { rung: "VPN control plane", evidence: "MP-BGP Established · route received", status: "ok" },
          { rung: "VRF import", evidence: `RT ${RT_WRONG} ∉ import ${RT_INTENDED}`, status: "fail" },
          { rung: "Data plane", evidence: "no VRF route → no labels → drop", status: "suspect" },
        ]}
      />
    </DiagramSvg>
  );
}

function RdRtDiagram() {
  return (
    <DiagramSvg h={150} label="RD makes the VPNv4 prefix unique and is part of the NLRI; RT is an extended community that drives import and export">
      <DTable
        x={40}
        y={8}
        title="Two different jobs"
        cols={[
          { label: "", w: 120 },
          { label: "RD", w: 220 },
          { label: "RT", w: 220 },
        ]}
        rows={[
          ["Carried as", "part of the VPNv4 prefix", "BGP extended community"],
          ["Purpose", "uniqueness of the prefix", "which VRFs import it"],
          ["In this lab", `${RD.PE1} (PE1) · ${RD.PE2} (PE2)`, `${RT_INTENDED} (intended)`],
          ["In packets?", "never", "never"],
        ]}
      />
    </DiagramSvg>
  );
}

function UpdateDiagram() {
  return (
    <DiagramSvg h={170} label={`PE2's VPNv4 route: RD ${RD.PE2}, prefix 10.50.2.0/24, VPN label ${VPN_LABEL.PE2}, next hop ${LOOP.PE2}, RT extended community`}>
      <DTable
        x={60}
        y={8}
        title="PE2's VPNv4 route (MP_REACH_NLRI, AFI 1 / SAFI 128)"
        cols={[
          { label: "FIELD", w: 180 },
          { label: "VALUE", w: 340 },
        ]}
        rows={[
          ["RD + prefix", `${RD.PE2} : ${CUST.ce2Lan}/24`],
          ["VPN label", `${VPN_LABEL.PE2} (allocated by PE2)`],
          ["BGP next hop", `${LOOP.PE2} (PE2's loopback)`],
          ["Route Target", `${RT_INTENDED} healthy · ${RT_WRONG} during the incident`],
        ]}
        highlight={{ row: 3, color: D.warning }}
      />
    </DiagramSvg>
  );
}

function ImportDiagram() {
  return (
    <DiagramSvg h={170} label="Import decision on PE1: the received route enters the VPNv4 table; its RT is compared with CUST-A's import list; only a match installs it in the VRF">
      <DNode x={90} y={60} label="VPNv4 table" sub="received" accent={D.ip} w={130} />
      <DNode x={320} y={60} label="RT check" sub={`import ${RT_INTENDED}`} accent={D.warning} w={140} />
      <DNode x={550} y={35} label={`VRF ${VRF}`} sub="installed" accent={D.success} w={130} h={40} />
      <DNode x={550} y={95} label="not imported" sub="stays in VPNv4 only" accent={D.danger} w={130} h={40} />
      <DArrow x1={156} y1={60} x2={249} y2={60} color={D.muted} />
      <DArrow x1={391} y1={52} x2={484} y2={38} color={D.success} label="RT 100" />
      <DArrow x1={391} y1={68} x2={484} y2={92} color={D.danger} label="RT 200" labelDy={16} />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        BGP can be Established and the route received — the VRF still decides.
      </text>
    </DiagramSvg>
  );
}

function StackDiagram() {
  const f = (label: string, sub: string, w: number, color: string, strong?: boolean) => ({ label, sub, w, color, strong });
  return (
    <DiagramSvg h={130} label={`The frame PE1 sends to P1: EtherType 0x8847, transport label ${LDP_LABEL.toPE2.P1} with S=0, VPN label ${VPN_LABEL.PE2} with S=1, then the customer IPv4 packet`}>
      <DFieldRow x={20} y={14} fields={[f("Ethernet", "0x8847", 90, D.eth), f("Transport", `${LDP_LABEL.toPE2.P1} · S=0`, 130, D.mpls, true), f("VPN", `${VPN_LABEL.PE2} · S=1`, 120, D.violet, true), f("IPv4", `${CUST.ce1} → ${CUST.ce2}`, 160, D.ip), f("ICMP", "echo", 80, D.warning)]} />
      <text x={320} y={96} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        Transport label from LDP (reach PE2) · VPN label from the VPNv4 route (which VRF at PE2).
      </text>
    </DiagramSvg>
  );
}

function HopsDiagram() {
  return (
    <DiagramSvg h={170} label="Label stack per link: PE1 to P1 16004 over 24002, P1 to P2 17004 over 24002, P2 to PE2 24002 only after PHP, PE2 to CE2 plain IPv4">
      <DTable
        x={40}
        y={8}
        title="The customer echo on each link (healthy)"
        cols={[
          { label: "LINK", w: 120 },
          { label: "LABEL STACK (top / bottom)", w: 250 },
          { label: "CUSTOMER IP TTL", w: 160 },
        ]}
        rows={[
          ["CE1 → PE1", "none (plain IPv4)", "64"],
          ["PE1 → P1", `${LDP_LABEL.toPE2.P1} / ${VPN_LABEL.PE2}`, "63"],
          ["P1 → P2", `${LDP_LABEL.toPE2.P2} / ${VPN_LABEL.PE2}`, "63"],
          ["P2 → PE2", `${VPN_LABEL.PE2} (PHP popped the transport label)`, "63"],
          ["PE2 → CE2", "none (plain IPv4)", "62"],
        ]}
      />
    </DiagramSvg>
  );
}

function PDiagram() {
  return (
    <DiagramSvg h={140} label="P1 swaps the top label only; the VPN label and the customer packet underneath are never inspected">
      <DNode x={320} y={60} label="P1" sub="LFIB: top label only" accent={D.violet} w={150} h={50} />
      <DArrow x1={120} y1={60} x2={243} y2={60} color={D.mpls} label={`${LDP_LABEL.toPE2.P1} | ${VPN_LABEL.PE2} | IP`} />
      <DArrow x1={397} y1={60} x2={520} y2={60} color={D.mpls} label={`${LDP_LABEL.toPE2.P2} | ${VPN_LABEL.PE2} | IP`} />
      <text x={320} y={118} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        No VRF, no customer routes, no VPNv4 table: P routers could not look up 10.50.2.1 if they tried.
      </text>
    </DiagramSvg>
  );
}

function TransportDiagram() {
  return (
    <DiagramSvg h={150} label="Transport evidence during the incident: IGP route, LDP sessions, LFIB label and LSP ping all healthy">
      <DTable
        x={60}
        y={8}
        title="Transport plane — all healthy during the incident"
        cols={[
          { label: "CHECK", w: 220 },
          { label: "RESULT", w: 300 },
        ]}
        rows={[
          [`IGP route to ${LOOP.PE2}/32`, "present on PE1"],
          ["LDP sessions", "PE1–P1, P1–P2, P2–PE2 Operational"],
          [`PE1 FEC ${LOOP.PE2}/32`, `push ${LDP_LABEL.toPE2.P1}`],
          [`LSP ping ${LOOP.PE2}/32`, "5/5"],
        ]}
      />
    </DiagramSvg>
  );
}

function ReceivedDiagram() {
  return (
    <DiagramSvg h={150} label="PE1 during the incident: the VPNv4 table holds 65000:2:10.50.2.0/24 with RT 65000:200; VRF CUST-A does not contain 10.50.2.0/24">
      <DTable
        x={40}
        y={8}
        title="PE1 — received vs imported (incident)"
        cols={[
          { label: "TABLE", w: 170 },
          { label: "10.50.2.0/24?", w: 390 },
        ]}
        rows={[
          ["VPNv4 (received)", `yes — ${RD.PE2}:10.50.2.0/24 · label ${VPN_LABEL.PE2} · NH ${LOOP.PE2} · RT ${RT_WRONG}`],
          [`VRF ${VRF}`, `no — import policy accepts only ${RT_INTENDED}`],
        ]}
        highlight={{ row: 1, color: D.danger }}
      />
    </DiagramSvg>
  );
}

function StopDiagram() {
  return (
    <DiagramSvg h={140} label="CE1's packet reaches PE1 and is dropped at the VRF lookup; nothing is labelled, nothing enters the core">
      <SeqLanes
        lanes={[
          { x: 90, label: "CE1", color: D.cyan },
          { x: 260, label: "PE1", color: D.warning },
          { x: 430, label: "P1", color: D.violet },
          { x: 580, label: "PE2", color: D.warning },
        ]}
        msgs={[
          { from: 0, to: 1, label: "IPv4 → 10.50.2.1" },
          { from: 1, to: 2, label: "no VRF route", drop: true },
          { from: 2, to: 3, label: "(no labelled packet)", color: D.faint },
        ]}
      />
    </DiagramSvg>
  );
}

function VerifyDiagram() {
  return (
    <DiagramSvg h={150} label="Before and after the repair: RT 65000:200 to 65000:100, route not imported to imported, no labels to the two-label stack, ping 0 of 5 to 5 of 5">
      <DTable
        x={40}
        y={8}
        title="Same checks, before and after"
        cols={[
          { label: "CHECK", w: 200 },
          { label: "INCIDENT", w: 170 },
          { label: "AFTER REPAIR", w: 190 },
        ]}
        rows={[
          ["RT on PE2's route", RT_WRONG, RT_INTENDED],
          [`In PE1 ${VRF}?`, "no", "yes"],
          ["Leaves PE1 as", "nothing (dropped)", `${LDP_LABEL.toPE2.P1} / ${VPN_LABEL.PE2}`],
          ["CE1 → CE2", "0/5", "5/5"],
        ]}
        highlight={{ row: 2, color: D.success }}
      />
    </DiagramSvg>
  );
}

export function MpLessonGuideContent() {
  return (
    <div className="space-y-12">
      <GuideSection id="mpl-mission" eyebrow="Mission" title="A healthy core, an unreachable site" tone="cyan">
        <p>An MPLS VPN has several independent planes. When a customer site is unreachable, &quot;the core is up&quot; answers only part of the question. This lesson troubleshoots plane by plane until the failing one — and only that one — is identified.</p>
      </GuideSection>

      <GuideSection id="mpl-method" eyebrow="Method" title="Scope by plane" tone="violet">
        <DiagramFrame caption="Evidence tells you which plane to open first.">
          <DiagramSvg h={82} label="Troubleshooting workflow">
            <WorkflowDiagram notes={["which site?", "which plane?", "each plane", "one policy", "config vs design", "one change", "labels + ping"]} />
          </DiagramSvg>
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpl-topology" eyebrow="Topology" title="PE, P and CE roles" tone="cyan">
        <DiagramFrame caption="PEs hold customer state; P routers only switch labels.">
          <TopologyDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpl-planes" eyebrow="Planes" title="Five planes, one failure" tone="violet">
        <DiagramFrame caption="The lowest failing plane is the VRF import.">
          <PlanesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpl-rd-rt" eyebrow="VPN control plane" title="RD vs RT" tone="warning">
        <DiagramFrame caption="Never conflate the two.">
          <RdRtDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpl-update" eyebrow="VPN control plane" title="PE2's VPNv4 route" tone="warning">
        <DiagramFrame caption="One route carries the prefix, the label, the next hop and the policy tag.">
          <UpdateDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpl-import" eyebrow="VRF" title="The import decision" tone="success">
        <DiagramFrame caption="Received routes are filtered per VRF by Route Target.">
          <ImportDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpl-stack" eyebrow="Data plane" title="The two-label stack" tone="ip">
        <DiagramFrame caption="Two labels from two different protocols.">
          <StackDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpl-hops" eyebrow="Data plane" title="Hop by hop" tone="ip">
        <DiagramFrame caption="Only the outer label changes in the core.">
          <HopsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpl-p" eyebrow="Core" title="What a P router does" tone="violet">
        <DiagramFrame caption="Top label in, top label out.">
          <PDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpl-transport" eyebrow="Evidence" title="Transport is healthy" tone="success">
        <DiagramFrame caption="Rule planes out with evidence, not assumptions.">
          <TransportDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpl-received" eyebrow="Evidence" title="Received, but not imported" tone="danger">
        <DiagramFrame caption="The route is on PE1 — in the wrong table.">
          <ReceivedDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Resetting things does not help">
          Clearing LDP or BGP sessions would bring the same route back with the same Route Target. Fix the policy, not the plumbing.
        </Callout>
      </GuideSection>

      <GuideSection id="mpl-stop" eyebrow="Evidence" title="Where customer traffic stops" tone="danger">
        <DiagramFrame caption="No VRF route, no labels — the core never sees the packet.">
          <StopDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="mpl-verify" eyebrow="Verify" title="Fix the export policy, prove it with labels" tone="success">
        <DiagramFrame caption="LDP, IGP and BGP sessions were never touched.">
          <VerifyDiagram />
        </DiagramFrame>
        <ChecklistCard tone="success" title="Verified" mark="✓" items={[`PE2 exports ${VRF} with RT ${RT_INTENDED}`, `PE1 imports ${RD.PE2}:10.50.2.0/24 into ${VRF}`, `CE1's echo leaves PE1 as ${LDP_LABEL.toPE2.P1} / ${VPN_LABEL.PE2}; P2 pops; PE2 delivers`, "CE1 → CE2 5/5"]} />
      </GuideSection>

      <GuideSection id="mpl-glossary" eyebrow="Glossary" title="Terms" tone="cyan">
        <Glossary
          items={[
            { term: "PE / P / CE", def: "Provider edge (VRFs, VPN routes), provider core (labels only), customer edge." },
            { term: "VRF", def: "A per-customer routing and forwarding table on a PE." },
            { term: "RD", def: "Route Distinguisher: prepended to a prefix to make it unique in VPNv4." },
            { term: "RT", def: "Route Target: extended community used for VRF import/export." },
            { term: "VPN label", def: "Inner label advertised with the VPNv4 route; selects the VRF at the egress PE." },
            { term: "Transport label", def: "Outer label from LDP (or RSVP/SR) that reaches the egress PE's loopback." },
          ]}
        />
      </GuideSection>
    </div>
  );
}
