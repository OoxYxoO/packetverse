import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, FieldTable, FlowSteps, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import { DHeaderColumn, SRV6_HEX_POS, Srv6Topology, type Srv6Link } from "@/components/lesson/Srv6GuideSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const SRV6E_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "le-mission", label: "The mission" },
  { id: "le-families", label: "Two behavior families" },
  { id: "le-tables", label: "R3 and R6 Local SID Tables" },
  { id: "le-three", label: "End, End.X and End.T" },
  { id: "le-endx", label: "What End.X really changes" },
  { id: "le-outer", label: "Outer vs inner packet" },
  { id: "le-final", label: "The final-segment rule" },
  { id: "le-dxdt", label: "DX vs DT" },
  { id: "le-dx2", label: "End.DX2" },
  { id: "le-stage", label: "Reading the R6 packet stage" },
  { id: "le-fault", label: "The wrong-CE incident" },
  { id: "le-challenge", label: "Program the endpoint" },
  { id: "le-mistakes", label: "Common mistakes" },
  { id: "le-glossary", label: "Glossary" },
  { id: "le-recap", label: "Mental model" },
];

const BASE: Srv6Link[] = [
  { a: "R1", b: "R2", label: "10" },
  { a: "R2", b: "R3", label: "10" },
  { a: "R3", b: "R6", label: "10" },
  { a: "R1", b: "R4", label: "5" },
  { a: "R4", b: "R5", label: "5" },
  { a: "R5", b: "R6", label: "5" },
  { a: "R3", b: "R4", label: "20" },
];

function FamiliesDiagram() {
  return (
    <DiagramSvg h={170} label="Topological behaviors End, End.X and End.T keep forwarding the SRv6 packet itself; service behaviors End.DX6, DX4, DT6, DT4 and DX2 remove the outer IPv6 header and deliver the inner payload">
      <DNode x={320} y={30} label="DA matches a local SID" sub="Local SID Table → bound behavior" accent={D.cyan} w={250} />
      <DArrow x1={260} y1={53} x2={170} y2={85} color={D.faint} width={1.4} />
      <DArrow x1={380} y1={53} x2={470} y2={85} color={D.faint} width={1.4} />
      <DNode x={170} y={110} label="End · End.X · End.T" sub="forward the SRv6 packet itself" accent={D.warning} w={230} />
      <DNode x={470} y={110} label="DX6 · DX4 · DT6 · DT4 · DX2" sub="decap, deliver the inner payload" accent={D.violet} w={250} />
      <text x={320} y={160} textAnchor="middle" fill={D.muted} fontSize={10}>
        D = decapsulation · X = cross-connect · T = table lookup · 6 / 4 / 2 = payload family (teaching aid)
      </text>
    </DiagramSvg>
  );
}

function ThreeBehaviorsDiagram() {
  const r3r6 = new Set(["R3-R6"]);
  const viaR4 = new Set(["R3-R4", "R4-R5", "R5-R6"]);
  return (
    <DiagramSvg h={250} label="Same next segment R6: End at R3 forwards R3 to R6 directly; End.X forces the R3 to R4 adjacency, then R4 R5 R6; End.T looks up table CORE-B, which has no R3-R6 link, and also leaves via R4">
      <Srv6Topology
        pos={SRV6_HEX_POS}
        links={BASE.map((l) => {
          const id = `${l.a}-${l.b}`;
          if (r3r6.has(id)) return { ...l, color: D.success, bold: true };
          if (viaR4.has(id)) return { ...l, color: D.warning, bold: true };
          if (id === "R1-R2" || id === "R2-R3") return { ...l, color: D.ip, bold: true };
          return { ...l, dashed: true };
        })}
        sub={{ R1: "headend", R3: "End / X / T", R6: "next segment" }}
        accent={{ R1: D.ip, R3: D.warning, R6: D.success }}
        boxW={82}
      />
      <text x={20} y={228} fill={D.success} fontSize={10.5} fontWeight={700}>
        End: FIB lookup in MAIN → R3 → R6
      </text>
      <text x={620} y={228} textAnchor="end" fill={D.warning} fontSize={10.5} fontWeight={700}>
        End.X (adjacency R4) · End.T (table CORE-B) → via R4
      </text>
      <text x={320} y={244} textAnchor="middle" fill={D.muted} fontSize={9.5}>
        all three: SL 1 → 0 and DA ← R6 End SID — only the forwarding treatment differs
      </text>
    </DiagramSvg>
  );
}

function OuterInnerDiagram() {
  return (
    <DiagramSvg h={190} label="Outer IPv6 header with DA equal to R6's service SID, no SRH for a single segment, carrying an inner IPv4 packet to 10.10.2.8; transit routers only read the outer header">
      <DHeaderColumn
        x={200}
        y={24}
        w={230}
        rows={[
          { text: "outer IPv6 · DA = 2001:db8:100:6:13::", color: D.warning, tag: "OUTER", strong: true },
          { text: "no SRH (single segment)", color: D.faint, tag: "SRH" },
          { text: "IPv4 · dst 10.10.2.8", color: D.ip, tag: "INNER" },
        ]}
      />
      <text x={345} y={40} fill={D.text} fontSize={11} fontWeight={700}>
        transport namespace
      </text>
      <text x={345} y={56} fill={D.muted} fontSize={10}>
        the DA is an SRv6 SID; R1–R5 read only this
      </text>
      <text x={345} y={100} fill={D.text} fontSize={11} fontWeight={700}>
        customer namespace
      </text>
      <text x={345} y={116} fill={D.muted} fontSize={10}>
        IPv6, IPv4 or an Ethernet frame,
      </text>
      <text x={345} y={130} fill={D.muted} fontSize={10}>
        exposed only by a service behavior
      </text>
      <text x={320} y={178} textAnchor="middle" fill={D.muted} fontSize={10}>
        R1 performs a simplified headend encapsulation here — the full H.Encaps lesson is SRv6 Policy
      </text>
    </DiagramSvg>
  );
}

function DxDtDiagram() {
  return (
    <DiagramSvg h={200} label="DX: decapsulate then send to a fixed adjacency, no lookup. DT: decapsulate, select a table, look up the inner destination, and the result picks the CE">
      <text x={160} y={22} textAnchor="middle" fill={D.warning} fontSize={12} fontWeight={700}>
        DX — cross-connect
      </text>
      <DNode x={160} y={60} label="decapsulate" accent={D.warning} w={150} h={34} />
      <DArrow x1={160} y1={78} x2={160} y2={106} color={D.faint} width={1.4} />
      <DNode x={160} y={126} label="fixed adjacency" sub="bound in the SID entry" accent={D.warning} w={170} />
      <text x={160} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        the SID itself chose the neighbor
      </text>
      <text x={480} y={22} textAnchor="middle" fill={D.violet} fontSize={12} fontWeight={700}>
        DT — table lookup
      </text>
      <DNode x={480} y={60} label="decapsulate" accent={D.violet} w={150} h={34} />
      <DArrow x1={480} y1={78} x2={480} y2={106} color={D.faint} width={1.4} />
      <DNode x={480} y={126} label="lookup in bound table" sub="inner destination decides" accent={D.violet} w={200} />
      <text x={480} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        one SID can reach several CEs
      </text>
    </DiagramSvg>
  );
}

function StageDiagram() {
  return (
    <DiagramSvg h={150} label="The R6 to R6 packet shown at a service step is the input before decapsulation: outer IPv6 with the service SID plus the inner payload. The delivery to the CE is recorded in the journey, not drawn as a separate packet">
      <DHeaderColumn
        x={170}
        y={34}
        w={210}
        rows={[
          { text: "outer IPv6 · DA = service SID", color: D.warning, strong: true },
          { text: "inner payload", color: D.ip },
        ]}
        caption="R6 → R6 · badge END.DT4 (etc.)"
      />
      <text x={170} y={20} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        what the Inspector shows
      </text>
      <DArrow x1={290} y1={58} x2={370} y2={58} color={D.faint} width={1.4} label="behavior runs" />
      <DNode x={500} y={58} label="journey records" sub="delivered to CE…" accent={D.success} w={170} />
      <text x={320} y={138} textAnchor="middle" fill={D.muted} fontSize={10}>
        the label says &quot;Stage shown: at R6 before … decap&quot; — it never pretends the header is already gone
      </text>
    </DiagramSvg>
  );
}

export function Srv6EndpointLessonGuideContent() {
  return (
    <>
      <GuideSection id="le-mission" eyebrow="Introduction" title="The mission: what happens after the SID is reached" tone="ip">
        <p>
          SRv6 Foundations gave R3 one End SID. Here R3 and R6 get several SIDs under the same locator, each bound to a different behavior, and every behavior is proven with a real packet.
        </p>
        <Callout tone="cyan" title="Scope of this simulation" icon="i">
          Eight behaviors are implemented: End, End.X, End.T, End.DX6, End.DX4, End.DT6, End.DT4 and End.DX2. Flavors (PSP/USP/USD), End.DT46, the L2 table behaviors and End.B6.Encaps are named as previews only.
        </Callout>
      </GuideSection>

      <GuideSection id="le-families" eyebrow="Concepts" title="Two behavior families" tone="violet">
        <DiagramFrame caption="The bound behavior — never the address alone — decides what happens next.">
          <FamiliesDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="le-tables" eyebrow="Local SID state" title="R3 and R6 Local SID Tables" tone="ip">
        <FieldTable
          title="Instantiated SIDs (locator 2001:db8:100:N::/64, 16-bit function)"
          accent="ip"
          columns={["SID", "Behavior", "Parameter"]}
          rows={[
            [<Mono key="1">2001:db8:100:3:1::</Mono>, "End", "—"],
            [<Mono key="2">2001:db8:100:3:2::</Mono>, "End.X", "adjacency R4"],
            [<Mono key="3">2001:db8:100:3:3::</Mono>, "End.T", "IPv6 table CORE-B"],
            [<Mono key="4">2001:db8:100:6:1::</Mono>, "End", "—"],
            [<Mono key="5">2001:db8:100:6:10::</Mono>, "End.DX6", "adjacency CE6"],
            [<Mono key="6">2001:db8:100:6:11::</Mono>, "End.DX4", "adjacency CE4-A"],
            [<Mono key="7">2001:db8:100:6:12::</Mono>, "End.DT6", "table VRF-CUST6"],
            [<Mono key="8">2001:db8:100:6:13::</Mono>, "End.DT4", "table VRF-CUST4"],
            [<Mono key="9">2001:db8:100:6:15::</Mono>, "End.DX2", "OIF ge-0/0/7 → CE-L2"],
          ]}
        />
        <p>
          Function <Mono>0x14</Mono> is reserved for End.DT46 and never instantiated. The table shows the healthy starting state; always read the live Local SID Table tab in Device Explorer.
        </p>
      </GuideSection>

      <GuideSection id="le-three" eyebrow="Data plane" title="End, End.X and End.T against one next segment" tone="warning">
        <DiagramFrame caption="Policies A, B and C all end at R6's End SID. The topology adds R3-R4 (metric 20).">
          <ThreeBehaviorsDiagram />
        </DiagramFrame>
        <FlowSteps
          steps={[
            { title: "Policy A · End", body: "R1 → R2 → R3 → R6.", tone: "success" },
            { title: "Policy B · End.X", body: "R3 sends out its bound adjacency to R4: R1 → R2 → R3 → R4 → R5 → R6.", tone: "warning" },
            { title: "Policy C · End.T", body: "R3 looks up R6's locator in CORE-B (no R3-R6 link): same R3 → R4 → R5 → R6.", tone: "ospf" },
          ]}
        />
      </GuideSection>

      <GuideSection id="le-endx" eyebrow="Accuracy" title="What End.X really changes" tone="warning">
        <CompareCards
          items={[
            { title: "Changes", tone: "warning", tag: "End.X", points: ["The outgoing adjacency (R3 → R4)", "Nothing about the next DA"] },
            { title: "Does not change", tone: "success", tag: "same as End", points: ["SL 1 → 0", "DA ← next SID (R6 End)", "The DA never becomes R4's address"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="le-outer" eyebrow="Service behaviors" title="Outer vs inner packet" tone="violet">
        <DiagramFrame caption="Two different namespaces in one packet.">
          <OuterInnerDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="le-final" eyebrow="Service behaviors" title="The final-segment rule" tone="danger">
        <p>
          Service behaviors are modeled as final-segment behaviors. When an SRH is present, SL must be 0 when the service SID is active. The lesson&apos;s deliberately wrong program ⟨R6 End.DT4, R3 End⟩ reaches R6 with SL 1 and is rejected as <Mono>INVALID_FINAL_SEGMENT</Mono>: no decapsulation, no lookup.
        </p>
      </GuideSection>

      <GuideSection id="le-dxdt" eyebrow="Service behaviors" title="DX vs DT" tone="violet">
        <DiagramFrame caption="X = cross-connect, T = table lookup.">
          <DxDtDiagram />
        </DiagramFrame>
        <FieldTable
          title="What the lesson sends"
          accent="violet"
          columns={["Service SID", "Inner packet", "Outcome"]}
          rows={[
            ["End.DX6", "IPv6 to 2001:db8:cafe:6::b", "Cross-connected to CE6"],
            ["End.DX4", "IPv4 to 10.10.1.5", "Cross-connected to CE4-A"],
            ["End.DT6", "IPv6 to 2001:db8:cafe:6::b", "VRF-CUST6 lookup → CE6"],
            ["End.DT4", "IPv4 to 10.10.1.5", "VRF-CUST4: 10.10.1.0/24 → CE4-A"],
            ["End.DT4 (same SID)", "IPv4 to 10.10.2.8", "VRF-CUST4: 10.10.2.0/24 → CE4-B"],
          ]}
        />
      </GuideSection>

      <GuideSection id="le-dx2" eyebrow="Service behaviors" title="End.DX2" tone="ethernet">
        <p>
          The inner payload is an Ethernet frame (CE-A-MAC → CE-B-MAC). End.DX2 removes the outer IPv6 header and sends the frame out the bound interface <Mono>ge-0/0/7</Mono> toward CE-L2 — no MAC learning, no bridge table, no flooding. VLAN-aware and MAC-table behaviors (End.DX2V, End.DT2U, End.DT2M) are previews.
        </p>
      </GuideSection>

      <GuideSection id="le-stage" eyebrow="Reading the UI" title="Reading the R6 packet stage" tone="cyan">
        <DiagramFrame caption="What a service step's packet visual means.">
          <StageDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="le-fault" eyebrow="Troubleshooting" title="The wrong-CE incident" tone="danger">
        <ChecklistCard
          tone="danger"
          title="How to reason about it (no spoilers)"
          mark="→"
          items={[
            "List what the incident says is healthy — take it at its word, then verify.",
            "Follow the packet to the router where the outcome diverges.",
            "At that router, read every table that could decide the outcome: FIB, Local SID Table, VRFs.",
            "For each candidate cause, predict what the packet would do — and compare with what you observed.",
            "After a fix, resend the same packet and confirm which CE it reaches.",
          ]}
        />
      </GuideSection>

      <GuideSection id="le-challenge" eyebrow="Challenge" title="Program the endpoint" tone="violet">
        <p>
          Four requirements, one behavior each. For every requirement, ask: does the packet keep moving as SRv6 or get decapsulated? If it keeps moving, is a specific adjacency or a specific table needed? If it is decapsulated, what is the payload family, and is the neighbor fixed or chosen by a lookup? Each answer was already proven by a packet in this lesson.
        </p>
      </GuideSection>

      <GuideSection id="le-mistakes" eyebrow="Troubleshooting" title="Common mistakes" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Avoid these"
          mark="!"
          items={[
            "Describing End.X as rewriting the DA to the neighbor's address.",
            "Confusing End.T (no decap) with End.DT6 (decap + lookup).",
            "Expecting a DX behavior to consult a VRF.",
            "Executing a service SID while SL > 0.",
            "Treating behavior names as cosmetic labels.",
            "Reading the pre-decap R6 packet as already delivered.",
          ]}
        />
      </GuideSection>

      <GuideSection id="le-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "End.X", def: "End plus a forced L3 adjacency — the SRv6 analog of an Adj-SID." },
            { term: "End.T", def: "End plus a lookup in a specific IPv6 table; no decapsulation." },
            { term: "End.DX6 / DX4", def: "Decapsulate and cross-connect the IPv6 / IPv4 payload to a fixed neighbor." },
            { term: "End.DT6 / DT4", def: "Decapsulate and look the payload up in a bound table." },
            { term: "End.DX2", def: "Decapsulate and send the Ethernet frame out a bound interface." },
            { term: "Final segment", def: "Active segment with SL = 0 (or no SRH)." },
            { term: "CORE-B", def: "This lesson's second IPv6 table at R3, excluding the R3-R6 link." },
          ]}
        />
      </GuideSection>

      <GuideSection id="le-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          The SID gets the packet to an instruction; the behavior bound in the owner&apos;s Local SID Table defines the instruction — keep moving, force a link, change tables, or remove the outer header and deliver what is inside.
        </Callout>
      </GuideSection>
    </>
  );
}
