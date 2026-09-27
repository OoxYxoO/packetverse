import { Callout, ChecklistCard, DArrow, DIAGRAM as D, DNode, DiagramFrame, DiagramSvg, Glossary, GuideSection } from "@/components/lesson/GuideBlocks";
import { DRouteCard } from "@/components/lesson/EvpnGuideSvg";
import { DualHomedFabric } from "@/components/lesson/EvpnMultihomingSvg";
import type { LessonGuideSectionLink } from "@/components/lesson/LessonGuideDialog";
import { ESI, HOST_B_IP, SERVER_A_IP, SERVER_A_MAC, VNI, VTEP_LOOPBACK } from "@/lib/sim-engine/scenarios/evpnAliasingMassWithdrawal";

export const EVPNAL_LESSON_SECTIONS: LessonGuideSectionLink[] = [
  { id: "lal-mission", label: "The mission" },
  { id: "lal-type2", label: "The multihomed Type 2" },
  { id: "lal-prereq", label: "Forwarding prerequisites" },
  { id: "lal-flows", label: "Flow A / Flow B" },
  { id: "lal-df", label: "Not a DF decision" },
  { id: "lal-failure", label: "ES-attachment failure" },
  { id: "lal-withdraw", label: "Received vs applied" },
  { id: "lal-after", label: "After convergence" },
  { id: "lal-fault", label: "The incident" },
  { id: "lal-glossary", label: "Glossary" },
  { id: "lal-recap", label: "Mental model" },
];

const ESI_SHORT = ESI.slice(-8);
const LEAF_SUB = { LEAF1: `VTEP ${VTEP_LOOPBACK.LEAF1}`, LEAF2: `VTEP ${VTEP_LOOPBACK.LEAF2}`, LEAF3: `VTEP ${VTEP_LOOPBACK.LEAF3}` };

function Type2Diagram() {
  return (
    <DiagramSvg h={200} label={`Type 2 route for SERVER-A: MAC ${SERVER_A_MAC}, IP ${SERVER_A_IP}, ESI ${ESI}, originated by LEAF1 — it names the segment, not a list of next hops`}>
      <DRouteCard
        x={20}
        y={14}
        w={330}
        title="Type 2 — SERVER-A (originated by LEAF1)"
        rows={[
          { label: "MAC", value: SERVER_A_MAC },
          { label: "IP", value: SERVER_A_IP },
          { label: "ESI", value: ESI, strong: true },
          { label: "BGP next hop", value: `${VTEP_LOOPBACK.LEAF1} (originator)` },
        ]}
      />
      <DRouteCard x={372} y={14} w={250} title="It does NOT carry" color={D.faint} rows={[{ label: "a next-hop list", value: "—" }, { label: "the ESI as next hop", value: "—" }]} />
      <text x={320} y={160} textAnchor="middle" fill={D.text} fontSize={11}>
        the ESI tells LEAF3 which segment to resolve through the A-D routes
      </text>
    </DiagramSvg>
  );
}

function PrereqDiagram() {
  const cols = ["per-EVI (Tag 0, VNI " + VNI + ")", "per-ES (MAX-ET, All-Active)", "eligible?"];
  const rows: [string, string[]][] = [
    ["LEAF1", ["✓ active", "✓ flag 0", "YES"]],
    ["LEAF2", ["✓ active", "✓ flag 0", "YES"]],
    ["per-EVI only", ["✓ active", "✗ missing", "NO"]],
  ];
  return (
    <DiagramSvg h={200} label="A leaf is an eligible next hop only with both an active per-EVI route and an active All-Active per-ES route; a per-EVI route alone is not enough">
      {cols.map((c, i) => (
        <text key={c} x={230 + i * 150} y={26} textAnchor="middle" fill={D.muted} fontSize={10} fontWeight={700}>
          {c}
        </text>
      ))}
      {rows.map(([who, cells], r) => (
        <g key={who}>
          <text x={40} y={60 + r * 40} fill={D.text} fontSize={11} fontWeight={700}>
            {who}
          </text>
          {cells.map((c, i) => {
            const bad = c.startsWith("✗") || c === "NO";
            return (
              <g key={`${who}-${i}`}>
                <rect x={170 + i * 150} y={44 + r * 40} width={120} height={26} rx={7} fill={bad ? D.danger : D.success} fillOpacity={0.12} stroke={bad ? D.danger : D.success} strokeOpacity={0.7} />
                <text x={230 + i * 150} y={61 + r * 40} textAnchor="middle" fill={D.text} fontSize={10.5} fontWeight={700}>
                  {c}
                </text>
              </g>
            );
          })}
        </g>
      ))}
      <text x={320} y={186} textAnchor="middle" fill={D.muted} fontSize={10}>
        the third row is a counter-example, not part of this lesson&apos;s state
      </text>
    </DiagramSvg>
  );
}

function FlowsDiagram() {
  return (
    <DiagramSvg h={190} label={`LEAF3's eligible set for SERVER-A is LEAF1 and LEAF2; the teaching flow selection sends Flow A to ${VTEP_LOOPBACK.LEAF1} and Flow B to ${VTEP_LOOPBACK.LEAF2}`}>
      <DNode x={100} y={90} label="LEAF3" sub={`eligible {LEAF1, LEAF2}`} accent={D.bgp} w={170} />
      <DArrow x1={186} y1={80} x2={420} y2={42} color={D.ip} label="Flow A" />
      <DArrow x1={186} y1={100} x2={420} y2={138} color={D.ip} label="Flow B" labelDy={18} />
      <DNode x={500} y={42} label="LEAF1" sub={VTEP_LOOPBACK.LEAF1} accent={D.violet} w={150} />
      <DNode x={500} y={138} label="LEAF2" sub={VTEP_LOOPBACK.LEAF2} accent={D.violet} w={150} />
      <text x={320} y={180} textAnchor="middle" fill={D.muted} fontSize={10}>
        a deterministic teaching abstraction — not a real hash, and packets do not alternate one by one
      </text>
    </DiagramSvg>
  );
}

function FailureDiagram() {
  return (
    <DiagramSvg h={250} label="LEAF1's ES attachment fails while LEAF1, its underlay and BGP stay up; until LEAF3 converges, a flow selecting LEAF1 cannot reach SERVER-A">
      <DualHomedFabric
        leafSub={LEAF_SUB}
        serverSub={SERVER_A_IP}
        hostSub={`${HOST_B_IP} · sends flows`}
        esLabel={`ESI …${ESI_SHORT} · LEAF1 link down`}
        failedAttachment="LEAF1"
        badges={{ LEAF1: { text: "device up · ES link down", color: D.danger }, LEAF2: { text: "attachment up", color: D.success } }}
      />
    </DiagramSvg>
  );
}

function ReceivedAppliedDiagram() {
  const box = (x: number, t: string, s: string, c: string) => (
    <g>
      <rect x={x} y={40} width={180} height={62} rx={10} fill={c} fillOpacity={0.12} stroke={c} strokeOpacity={0.75} />
      <text x={x + 90} y={64} textAnchor="middle" fill={D.text} fontSize={11} fontWeight={700}>
        {t}
      </text>
      <text x={x + 90} y={84} textAnchor="middle" fill={D.muted} fontSize={10} fontFamily="monospace">
        {s}
      </text>
    </g>
  );
  return (
    <DiagramSvg h={170} label="LEAF1 sends the per-ES withdrawal; LEAF3 records it in the control plane; only after mass-withdrawal processing does its applied forwarding set change from LEAF1 and LEAF2 to LEAF2">
      {box(14, "LEAF1 withdraws", "Type 1 per-ES", D.bgp)}
      <DArrow x1={196} y1={71} x2={228} y2={71} color={D.faint} width={1.4} />
      {box(230, "LEAF3 received", "applied: {LEAF1, LEAF2}", D.warning)}
      <DArrow x1={412} y1={71} x2={444} y2={71} color={D.faint} width={1.4} />
      {box(446, "LEAF3 applied", "applied: {LEAF2}", D.success)}
      <text x={320} y={140} textAnchor="middle" fill={D.muted} fontSize={10}>
        control-plane fact first, forwarding state after processing
      </text>
    </DiagramSvg>
  );
}

function AfterDiagram() {
  return (
    <DiagramSvg h={170} label={`After mass withdrawal both flows use LEAF2 (${VTEP_LOOPBACK.LEAF2}); SERVER-A stays reachable`}>
      <DNode x={100} y={80} label="LEAF3" sub="eligible {LEAF2}" accent={D.bgp} w={160} />
      <DArrow x1={181} y1={72} x2={410} y2={72} color={D.success} label="Flow A" />
      <DArrow x1={181} y1={90} x2={410} y2={90} color={D.success} label="Flow B" labelDy={18} />
      <DNode x={490} y={80} label="LEAF2" sub={VTEP_LOOPBACK.LEAF2} accent={D.success} w={150} />
      <text x={320} y={150} textAnchor="middle" fill={D.muted} fontSize={10}>
        SERVER-A&apos;s MAC and IP never changed — only the usable next hops did
      </text>
    </DiagramSvg>
  );
}

export function EvpnAliasingLessonGuideContent() {
  return (
    <>
      <GuideSection id="lal-mission" eyebrow="Introduction" title="The mission: every path, and fast cleanup" tone="cyan">
        <p>SERVER-A is All-Active multihomed to LEAF1 and LEAF2. This lesson asks two questions about known unicast from HOST-B: can LEAF3 use both leafs, and how quickly can it stop using one that loses its attachment?</p>
      </GuideSection>

      <GuideSection id="lal-type2" eyebrow="Control plane" title="The multihomed Type 2 route" tone="bgp">
        <DiagramFrame caption="Values from this lesson's Type 2 route.">
          <Type2Diagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lal-prereq" eyebrow="Control plane" title="Forwarding prerequisites" tone="bgp">
        <DiagramFrame caption="Both A-D forms are needed before a leaf becomes a next hop.">
          <PrereqDiagram />
        </DiagramFrame>
        <Callout tone="warning" title="Per-EVI alone is not enough" icon="!">
          RFC 7432 §8.4: a remote PE must not use a per-EVI route for forwarding until it also has the associated per-ES route — which also tells it the segment is All-Active.
        </Callout>
      </GuideSection>

      <GuideSection id="lal-flows" eyebrow="Data plane" title="Flow A / Flow B" tone="ip">
        <DiagramFrame caption="Two example flows, two eligible leafs.">
          <FlowsDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lal-df" eyebrow="Concept" title="Not a DF decision" tone="violet">
        <p>Known-unicast selection never checks the DF role. A leaf that is NDF for BUM is still a normal aliasing next hop for known unicast.</p>
      </GuideSection>

      <GuideSection id="lal-failure" eyebrow="Failure" title="ES-attachment failure" tone="danger">
        <DiagramFrame caption="Only the attachment fails.">
          <FailureDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lal-withdraw" eyebrow="Convergence" title="Received vs applied" tone="warning">
        <DiagramFrame caption="Mass withdrawal: one per-ES withdrawal, then processing.">
          <ReceivedAppliedDiagram />
        </DiagramFrame>
        <Callout tone="cyan" title="Not one MAC at a time" icon="i">
          The per-ES withdrawal prunes LEAF1 for every destination behind this segment at once. The per-EVI route is not the mass-withdraw signal.
        </Callout>
      </GuideSection>

      <GuideSection id="lal-after" eyebrow="Data plane" title="After convergence" tone="success">
        <DiagramFrame caption="The surviving leaf carries every flow.">
          <AfterDiagram />
        </DiagramFrame>
      </GuideSection>

      <GuideSection id="lal-fault" eyebrow="Troubleshooting" title="The incident" tone="danger">
        <ChecklistCard tone="danger" title="How to reason about it (no spoilers)" mark="→" items={["Describe the symptom: which flows fail and which work?", "Walk the layers: attachments, underlay, BGP, Type 2, A-D routes, applied forwarding state.", "Compare what the control plane says with what forwarding uses.", "Pick the fix only for the first layer that disagrees."]} />
      </GuideSection>

      <GuideSection id="lal-glossary" eyebrow="Reference" title="Glossary" tone="cyan">
        <Glossary
          items={[
            { term: "Aliasing", def: "Using every eligible PE of an All-Active segment for known unicast." },
            { term: "A-D per-EVI", def: "“This PE serves this EVI on the segment” — Ethernet Tag 0, VNI in the label." },
            { term: "A-D per-ES", def: "“This PE is attached to the segment” — MAX-ET, carries the Single-Active flag." },
            { term: "Mass withdrawal", def: "One per-ES withdrawal pruning a PE for every destination behind the segment." },
            { term: "Applied state", def: "What forwarding actually uses — can lag a received withdrawal until processed." },
          ]}
        />
      </GuideSection>

      <GuideSection id="lal-recap" eyebrow="Recap" title="Mental model" tone="success">
        <Callout tone="success" title="One sentence" icon="✓">
          Type 2 names the segment, per-EVI plus All-Active per-ES routes turn it into a set of usable leafs, flows spread across that set, and one per-ES withdrawal — once processed — removes a failed leaf for everything behind the segment.
        </Callout>
      </GuideSection>
    </>
  );
}
