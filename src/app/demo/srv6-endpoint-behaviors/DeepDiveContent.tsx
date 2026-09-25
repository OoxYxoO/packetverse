import { Callout, ChecklistCard, CompareCards, DArrow, DIAGRAM as D, DNode, DPill, DiagramFrame, DiagramSvg, FieldTable, Glossary, GuideSection, Mono } from "@/components/lesson/GuideBlocks";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";

export const SRV6E_DEEP_DIVE_SECTIONS: LessonGuideSectionLink[] = [
  { id: "ed-pipeline", label: "Endpoint processing pipeline" },
  { id: "ed-catalog", label: "The RFC 8986 catalog" },
  { id: "ed-next", label: "Choosing the next hop" },
  { id: "ed-decap", label: "Decapsulation behaviors" },
  { id: "ed-alloc", label: "Per-CE vs per-VRF SIDs" },
  { id: "ed-l2", label: "Layer-2 behaviors" },
  { id: "ed-flavors", label: "PSP, USP and USD" },
  { id: "ed-binding", label: "Binding behaviors" },
  { id: "ed-errors", label: "Error handling" },
  { id: "ed-trouble", label: "Troubleshooting" },
  { id: "ed-verify", label: "Verification" },
  { id: "ed-glossary", label: "Glossary" },
  { id: "ed-mental", label: "Mental model" },
];

function PipelineDiagram() {
  return (
    <DiagramSvg h={200} label="Packet arrives; if the DA is not a local SID the node forwards it by FIB as transit; if it is, the bound behavior runs its checks and its action">
      <DNode x={90} y={50} label="packet in" sub="read IPv6 DA" accent={D.ip} w={130} />
      <DArrow x1={156} y1={50} x2={224} y2={50} color={D.faint} width={1.4} />
      <DNode x={300} y={50} label="DA in Local SID Table?" accent={D.cyan} w={150} />
      <DArrow x1={300} y1={72} x2={300} y2={120} color={D.faint} width={1.4} />
      <text x={310} y={100} fill={D.faint} fontSize={10} fontWeight={700}>
        no
      </text>
      <DNode x={300} y={144} label="transit" sub="ordinary IPv6 FIB" accent={D.faint} w={150} />
      <DArrow x1={376} y1={50} x2={444} y2={50} color={D.faint} width={1.4} label="yes" />
      <DNode x={530} y={50} label="bound behavior" sub="checks + action" accent={D.warning} w={160} />
      <DArrow x1={530} y1={72} x2={530} y2={120} color={D.faint} width={1.4} />
      <DNode x={530} y={144} label="SL / payload checks" sub="then advance or decap" accent={D.violet} w={170} />
    </DiagramSvg>
  );
}

function NextHopDiagram() {
  const cols = [
    { x: 120, t: "End", s: "FIB lookup on new DA", c: D.success },
    { x: 320, t: "End.X", s: "bound L3 adjacency", c: D.warning },
    { x: 520, t: "End.T", s: "lookup in bound table", c: D.ospf },
  ];
  return (
    <DiagramSvg h={150} label="All three advance the segment the same way; End uses the default FIB, End.X a bound adjacency, End.T a bound table">
      <DPill x={320} y={24} text="SL − 1 · DA ← Segment List[SL]  (identical for all three)" color={D.cyan} w={380} />
      {cols.map((c) => (
        <g key={c.t}>
          <DArrow x1={320} y1={38} x2={c.x} y2={74} color={D.faint} width={1.2} />
          <DNode x={c.x} y={100} label={c.t} sub={c.s} accent={c.c} w={170} />
        </g>
      ))}
    </DiagramSvg>
  );
}

function DecapDiagram() {
  const steps = [
    { t: "final segment?", c: D.danger },
    { t: "payload type ok?", c: D.warning },
    { t: "remove outer IPv6", c: D.violet },
    { t: "X: fixed neighbor / T: table", c: D.success },
  ];
  return (
    <DiagramSvg h={110} label="Decapsulation behaviors: check final segment, check payload type, remove the outer header, then cross-connect or look up">
      {steps.map((s, i) => (
        <g key={s.t}>
          <DPill x={82 + i * 158} y={40} text={s.t} color={s.c} w={148} />
          {i < steps.length - 1 && <DArrow x1={157 + i * 158} y1={40} x2={165 + i * 158} y2={40} color={D.faint} width={1.2} />}
        </g>
      ))}
      <text x={320} y={90} textAnchor="middle" fill={D.muted} fontSize={10}>
        a failed check discards the packet — the service action never runs
      </text>
    </DiagramSvg>
  );
}

function AllocationDiagram() {
  return (
    <DiagramSvg h={200} label="Per-CE allocation: one DX SID per attached CE. Per-VRF allocation: one DT SID for the whole VRF, and the lookup chooses the CE">
      <text x={160} y={20} textAnchor="middle" fill={D.warning} fontSize={11.5} fontWeight={700}>
        per-CE (DX)
      </text>
      {["CE-1", "CE-2", "CE-3"].map((ce, i) => (
        <g key={ce}>
          <DPill x={90} y={56 + i * 44} text={`SID ::${i + 1}`} color={D.warning} w={80} />
          <DArrow x1={132} y1={56 + i * 44} x2={196} y2={56 + i * 44} color={D.faint} width={1.2} />
          <DNode x={240} y={56 + i * 44} label={ce} accent={D.warning} w={80} h={30} />
        </g>
      ))}
      <text x={480} y={20} textAnchor="middle" fill={D.violet} fontSize={11.5} fontWeight={700}>
        per-VRF (DT)
      </text>
      <DPill x={380} y={100} text="one SID" color={D.violet} w={80} />
      <DArrow x1={422} y1={100} x2={460} y2={100} color={D.faint} width={1.2} />
      <DNode x={505} y={100} label="VRF" sub="lookup" accent={D.violet} w={80} />
      {["CE-1", "CE-2", "CE-3"].map((ce, i) => (
        <g key={`v-${ce}`}>
          <DArrow x1={546} y1={100} x2={570} y2={56 + i * 44} color={D.faint} width={1} />
          <text x={576} y={60 + i * 44} fill={D.text} fontSize={10}>
            {ce}
          </text>
        </g>
      ))}
      <text x={320} y={192} textAnchor="middle" fill={D.muted} fontSize={10}>
        fewer SIDs vs no lookup — an allocation choice, not a protocol requirement
      </text>
    </DiagramSvg>
  );
}

function FlavorsDiagram() {
  const rows = [
    { y: 42, t: "PSP", s: "penultimate endpoint removes the SRH after SL reaches 0", c: D.warning },
    { y: 82, t: "USP", s: "ultimate endpoint removes the SRH, then processes the next header", c: D.violet },
    { y: 122, t: "USD", s: "ultimate endpoint removes the outer header and processes the inner packet", c: D.success },
  ];
  return (
    <DiagramSvg h={160} label="Flavors: PSP removes the SRH at the penultimate endpoint, USP at the ultimate endpoint, USD decapsulates the outer header at the ultimate endpoint">
      <text x={320} y={18} textAnchor="middle" fill={D.muted} fontSize={10}>
        flavors modify End, End.X and End.T
      </text>
      {rows.map((r) => (
        <g key={r.t}>
          <DPill x={70} y={r.y} text={r.t} color={r.c} w={64} />
          <text x={116} y={r.y + 4} fill={D.text} fontSize={10.5}>
            {r.s}
          </text>
        </g>
      ))}
    </DiagramSvg>
  );
}

export function Srv6EndpointDeepDiveContent() {
  return (
    <>
      <GuideSection id="ed-pipeline" eyebrow="Architecture" title="Endpoint processing pipeline" tone="ip">
        <DiagramFrame caption="Only a local SID match turns a router into an endpoint for this packet.">
          <PipelineDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ed-catalog" eyebrow="Concepts" title="The RFC 8986 catalog" tone="violet">
        <FieldTable
          title="Endpoint behaviors (summary)"
          accent="violet"
          columns={["Behavior", "Decap?", "Forwarding"]}
          rows={[
            [<Mono key="1">End</Mono>, "no", "FIB on the next SID"],
            [<Mono key="2">End.X</Mono>, "no", "Bound L3 adjacency"],
            [<Mono key="3">End.T</Mono>, "no", "Bound IPv6 table"],
            [<Mono key="4">End.DX6 / End.DX4</Mono>, "yes", "Fixed L3 neighbor"],
            [<Mono key="5">End.DT6 / End.DT4 / End.DT46</Mono>, "yes", "Lookup in bound table(s)"],
            [<Mono key="6">End.DX2 / DX2V / DT2U / DT2M</Mono>, "yes", "L2: interface, VLAN table, MAC table, flooding"],
            [<Mono key="7">End.B6.Encaps(.Red)</Mono>, "no", "Apply a bound SRv6 Policy"],
            [<Mono key="8">End.BM</Mono>, "no", "Apply a bound SR-MPLS policy"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-next" eyebrow="Forwarding" title="Choosing the next hop" tone="warning">
        <DiagramFrame caption="Segment advancement is shared; only the next-hop decision differs.">
          <NextHopDiagram />
        </DiagramFrame>
        <p>
          End behaves like a prefix segment and End.X like an adjacency segment. End.T lets one node steer into a separate topology or table without decapsulating.
        </p>
      </GuideSection>

      <GuideSection id="ed-decap" eyebrow="Services" title="Decapsulation behaviors" tone="violet">
        <DiagramFrame caption="Checks first, action second.">
          <DecapDiagram />
        </DiagramFrame>
        <p>
          The inner packet was built by a headend with H.Encaps (or a reduced variant). After decapsulation the node forwards the inner packet in the customer&apos;s address space — the provider&apos;s SID never appears there.
        </p>
      </GuideSection>

      <GuideSection id="ed-alloc" eyebrow="Design" title="Per-CE vs per-VRF SIDs" tone="bgp">
        <DiagramFrame caption="The same trade-off as per-CE vs per-VRF VPN labels in MPLS.">
          <AllocationDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="ed-l2" eyebrow="Services" title="Layer-2 behaviors" tone="ethernet">
        <CompareCards
          items={[
            { title: "End.DX2", tone: "ethernet", tag: "point-to-point", points: ["Decap, then send out one bound interface", "No MAC learning or bridge table"] },
            { title: "End.DX2V / DT2U / DT2M", tone: "violet", tag: "multipoint", points: ["VLAN-aware L2 table lookup", "Unicast MAC table lookup", "Flooding for BUM traffic"] },
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-flavors" eyebrow="Advanced" title="PSP, USP and USD" tone="warning">
        <DiagramFrame caption="When the SRH or outer header disappears.">
          <FlavorsDiagram />
        </DiagramFrame>
        <p>PSP is similar in spirit to MPLS PHP but is a separate mechanism: it removes an extension header, not a label, and is configured per SID.</p>
      </GuideSection>

      <GuideSection id="ed-binding" eyebrow="Advanced" title="Binding behaviors" tone="violet">
        <p>
          <Mono>End.B6.Encaps</Mono> binds a SID to an SRv6 Policy: the endpoint advances the incoming SRH, then pushes a new outer header and SRH for the bound policy. <Mono>End.BM</Mono> does the same toward an SR-MPLS policy. Both are covered in the SRv6 Policy lesson.
        </p>
      </GuideSection>

      <GuideSection id="ed-errors" eyebrow="Operations" title="Error handling" tone="danger">
        <FieldTable
          title="Checks and outcomes"
          accent="danger"
          columns={["Condition", "Result"]}
          rows={[
            ["Service behavior with SL > 0", "Discard — the service must be the final segment"],
            ["Payload type does not match the behavior", "Discard — e.g. IPv6 payload at End.DX4"],
            ["End with SL = 0", "Program finished — the node processes the next (upper-layer) header"],
            ["DA looks like a SID but is not instantiated", "No local match — not an endpoint"],
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-trouble" eyebrow="Operations" title="Troubleshooting" tone="warning">
        <ChecklistCard
          tone="warning"
          title="Endpoint checklist"
          mark="→"
          items={[
            "Locator reachable and the packet arrives at the owner?",
            "Exact SID present in the owner's Local SID Table?",
            "Bound behavior and parameter what you intended (adjacency, table, interface)?",
            "SL and payload type valid for that behavior?",
            "For DT: does the bound table hold the needed route? For DX: is the bound neighbor the right one?",
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-verify" eyebrow="Operations" title="Verification" tone="success">
        <ChecklistCard
          tone="success"
          title="Prove it with traffic"
          mark="✓"
          items={["Read the Local SID Table: SID, behavior, parameter.", "Send a real packet and capture it before and after the endpoint.", "Confirm the outer header is gone only after a decapsulation behavior.", "For DT, test two inner destinations behind the same SID."]}
        />
      </GuideSection>

      <GuideSection id="ed-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Endpoint behavior", def: "Processing bound to a local SID (RFC 8986)." },
            { term: "Cross-connect (X)", def: "Send to a fixed neighbor or interface, no lookup." },
            { term: "Table lookup (T)", def: "Look the destination up in a bound table." },
            { term: "Decapsulation (D)", def: "Remove the outer IPv6 header and expose the inner packet." },
            { term: "Flavor", def: "Modifier to End/End.X/End.T such as PSP, USP or USD." },
            { term: "Per-VRF SID", def: "One DT SID shared by all prefixes of a VRF." },
          ]}
        />
      </GuideSection>

      <GuideSection id="ed-mental" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          Every SRv6 behavior answers two questions — does the packet stay SRv6 or get decapsulated, and what picks the next hop: the FIB, a bound adjacency, a bound table, or a fixed neighbor.
        </Callout>
      </GuideSection>
    </>
  );
}
